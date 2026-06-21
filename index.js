/*
 * Card Roulette: forced discovery for forgotten character cards.
 *
 * Copy rules (from the user): buttons state the LITERAL action and must make
 * permanent deletion unmistakable. Any comedy lives only in subtext, option
 * descriptions, or hover tooltips. Keep toasts clean and clear.
 *
 * Flow:
 *   1. The dice button opens a random NON-favorited card.
 *   2. While locked, trying to leave warns clearly that it permanently deletes the card.
 *      (No backup. Leaving early = the card is gone for good.)
 *   3. After X user messages, a rating popup lets you choose:
 *        Favorite           : favorite the card, keep chatting
 *        Keep               : keep chatting, no favorite
 *        Delete Permanently : permanently delete the card, close the chat
 */

import { deleteCharacter } from '../../../../script.js';
import { POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';

const MODULE = 'cardRoulette';
const RATE = { FAVORITE: 1, KEEP: 2, DELETE: 3 };
const LEAVE = { DELETE: 1, STAY: 2 };

const DEFAULTS = {
    enabled: true,
    threshold: 8,      // user messages required to unlock
    lock: null,        // { avatar, count }, persisted so reloads cannot escape
    lastAvatar: null,  // most recently opened card, so the next roll can avoid a repeat
};

/** Fresh context every call. characterId / chat are snapshots, so never cache them. */
const ctx = () => SillyTavern.getContext();

let settings;                   // live reference into extension_settings[MODULE]
let programmaticSwitch = false; // true while WE drive selectCharacterById (not an escape)
let ratingOpen = false;         // guard against double rating popups

const isFav = (ch) => ch && (ch.fav === true || ch.fav === 'true');
const persist = () => ctx().saveSettingsDebounced();

function findIndexByAvatar(avatar) {
    return ctx().characters.findIndex((ch) => ch.avatar === avatar);
}

function nameByAvatar(avatar) {
    return ctx().characters.find((ch) => ch.avatar === avatar)?.name ?? 'this character';
}

function currentAvatar() {
    const c = ctx();
    return c.characters?.[c.characterId]?.avatar;
}

function clearLock() {
    settings.lock = null;
    persist();
    updateButton();
}

// ---------------------------------------------------------------------------
// Randomize
// ---------------------------------------------------------------------------
async function randomize() {
    if (!settings.enabled) {
        toastr.info('Card Roulette is turned off. Enable it in the extensions panel.');
        return;
    }
    if (settings.lock) {
        // Already in a session. Clicking returns you to the current card.
        const idx = findIndexByAvatar(settings.lock.avatar);
        if (idx >= 0 && currentAvatar() !== settings.lock.avatar) {
            programmaticSwitch = true;
            await ctx().selectCharacterById(idx);
        }
        toastr.info(`Finish with ${nameByAvatar(settings.lock.avatar)} first. ${settings.lock.count}/${settings.threshold} messages sent.`, 'Card Roulette');
        return;
    }

    const c = ctx();
    let pool = c.characters
        .map((ch, idx) => ({ ch, idx }))
        .filter(({ ch }) => !isFav(ch));

    if (pool.length === 0) {
        toastr.warning('Every card is already a favorite. Nothing left to discover.', 'Card Roulette');
        return;
    }

    // Anti-repeat: skip the card you just finished with, unless it is the only one left.
    if (settings.lastAvatar && pool.length > 1) {
        const fresh = pool.filter(({ ch }) => ch.avatar !== settings.lastAvatar);
        if (fresh.length > 0) pool = fresh;
    }

    const { ch, idx } = pool[Math.floor(Math.random() * pool.length)];
    settings.lock = { avatar: ch.avatar, count: 0 };
    settings.lastAvatar = ch.avatar;
    persist();

    // Only flag a programmatic switch if we are actually changing characters,
    // otherwise the flag never gets consumed (no CHAT_CHANGED fires for a no-op).
    if (currentAvatar() !== ch.avatar) {
        programmaticSwitch = true;
        await c.selectCharacterById(idx);
    }
    updateButton();
    toastr.info(`Opened ${ch.name}. Send ${settings.threshold} messages before you can rate or leave.`, 'Card Roulette', { timeOut: 6000 });
}

// ---------------------------------------------------------------------------
// Message counting
// ---------------------------------------------------------------------------
function onMessageSent() {
    if (!settings.lock) return;
    if (currentAvatar() !== settings.lock.avatar) return; // safety: only count the locked card

    settings.lock.count += 1;
    persist();
    updateButton();

    if (settings.lock.count >= settings.threshold) {
        promptRating();
    }
}

// ---------------------------------------------------------------------------
// Exit guard
// ---------------------------------------------------------------------------
async function onChatChanged() {
    if (!settings.lock) return;
    if (programmaticSwitch) { programmaticSwitch = false; return; }
    if (ratingOpen) return;

    // Still on the locked card (e.g. switched to another of its own chats)? Allow.
    if (currentAvatar() === settings.lock.avatar) return;

    const lockedAvatar = settings.lock.avatar;
    const lockedCount = settings.lock.count;
    const name = nameByAvatar(lockedAvatar);

    const choice = await ctx().callGenericPopup(
        `<b>Leaving now will permanently delete ${name} and every chat with them. This cannot be undone.</b><br><br>` +
        `You have only sent ${lockedCount}/${settings.threshold} messages so far.`,
        POPUP_TYPE.TEXT,
        '',
        {
            okButton: false,
            cancelButton: false,
            customButtons: [
                { text: 'Delete Permanently', result: LEAVE.DELETE, classes: ['menu_button', 'cr-danger'], tooltip: 'Some downloads were mistakes. This one will not be missed.' },
                { text: 'Go Back', result: LEAVE.STAY, classes: ['menu_button'], tooltip: 'Give them a fair shot first.' },
            ],
        },
    );

    if (choice === LEAVE.DELETE) {
        clearLock();
        await rejectCard(lockedAvatar, name);
    } else {
        // Stay: return to the locked card (also the safe default if dismissed).
        const idx = findIndexByAvatar(lockedAvatar);
        if (idx >= 0) {
            programmaticSwitch = true;
            await ctx().selectCharacterById(idx);
        } else {
            clearLock(); // card vanished somehow
        }
    }
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------
async function promptRating() {
    if (ratingOpen) return;
    ratingOpen = true;

    const lockedAvatar = settings.lock.avatar;
    const name = nameByAvatar(lockedAvatar);

    // Threshold reached. Release the guard immediately so the choice is free.
    clearLock();

    try {
        const choice = await ctx().callGenericPopup(
            `<div class="cr-rating-popup">` +
            `<h3>You have given ${name} a fair shot.</h3>` +
            `<p>Favorite keeps them and pins them to favorites. Keep just continues the chat. Delete removes them permanently.</p>` +
            `</div>`,
            POPUP_TYPE.TEXT,
            '',
            {
                okButton: false,
                cancelButton: false,
                allowVerticalScrolling: true,
                customButtons: [
                    { text: 'Favorite', result: RATE.FAVORITE, classes: ['menu_button'], tooltip: 'A keeper. Pins them to your favorites and keeps chatting.' },
                    { text: 'Keep', result: RATE.KEEP, classes: ['menu_button'], tooltip: 'Jury is still out. No favorite, but the chat lives on.' },
                    { text: 'Delete Permanently', result: RATE.DELETE, classes: ['menu_button', 'cr-danger'], tooltip: 'Some downloads were mistakes. Gone for good, no backup.' },
                ],
            },
        );

        if (choice === RATE.FAVORITE) {
            favoriteCurrent(lockedAvatar);
            toastr.success(`${name} added to favorites.`, 'Card Roulette');
        } else if (choice === RATE.DELETE) {
            await rejectCard(lockedAvatar, name);
        } else {
            // Keep or dismissed: leave the card as-is, keep chatting.
            toastr.info(`Kept ${name}.`, 'Card Roulette');
        }
    } finally {
        ratingOpen = false;
    }
}

function favoriteCurrent(avatar) {
    const c = ctx();
    if (currentAvatar() !== avatar) return; // only the open card's button is valid
    const ch = c.characters?.[c.characterId];
    if (isFav(ch)) return;
    $('#favorite_button').trigger('click'); // ST persists the fav via its own handler
}

// ---------------------------------------------------------------------------
// Reject: permanently delete the card and its chats. No backup.
// ---------------------------------------------------------------------------
async function rejectCard(avatar, name) {
    try {
        await deleteCharacter(avatar, { deleteChats: true });
        toastr.warning(`${name} was permanently deleted.`, 'Card Roulette');
    } catch (err) {
        console.error('[CardRoulette] delete failed:', err);
        toastr.error(`Could not delete ${name}.`, 'Card Roulette');
    }
}

// ---------------------------------------------------------------------------
// Restore a lock after reload (so reloading cannot be an escape hatch)
// ---------------------------------------------------------------------------
function restoreLock() {
    if (!settings.lock || !settings.enabled) {
        updateButton();
        return;
    }
    const idx = findIndexByAvatar(settings.lock.avatar);
    if (idx < 0) { clearLock(); return; }                       // card no longer exists
    if (settings.lock.count >= settings.threshold) { clearLock(); return; }

    if (currentAvatar() !== settings.lock.avatar) {
        programmaticSwitch = true;
        ctx().selectCharacterById(idx);
    }
    updateButton();
    toastr.info(`Back on ${nameByAvatar(settings.lock.avatar)}. ${settings.lock.count}/${settings.threshold} messages sent.`, 'Card Roulette');
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function updateButton() {
    const $btn = $('#card_roulette_btn');
    if ($btn.length) {
        if (settings.lock) {
            $btn.addClass('cr-locked fa-lock').removeClass('fa-dice');
            $btn.attr('title', `Card Roulette: in a session with ${nameByAvatar(settings.lock.avatar)} (${settings.lock.count}/${settings.threshold}). Click to return.`);
        } else {
            $btn.addClass('fa-dice').removeClass('cr-locked fa-lock');
            $btn.attr('title', 'Card Roulette: open a random card you forgot about');
        }
    }
    // Lock state and the settings status line always move together.
    refreshStatus();
}

function injectButton() {
    if ($('#card_roulette_btn').length) return;
    const $container = $('#rm_buttons_container');
    if (!$container.length) return;
    const $btn = $('<div id="card_roulette_btn" class="menu_button fa-solid fa-dice" title="Card Roulette: open a random card you forgot about"></div>');
    $btn.on('click', randomize);
    $container.append($btn);
    updateButton();
}

function injectSettings() {
    const html = `
    <div id="card_roulette_settings" class="card-roulette-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Card Roulette</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <small>Opens a random card you forgot you downloaded and makes you actually talk to it before you can judge it.</small>
                <div class="cr-field">
                    <label for="cr_enabled">Enabled</label>
                    <input type="checkbox" id="cr_enabled">
                </div>
                <div class="cr-field">
                    <label for="cr_threshold">Messages before you can rate or leave</label>
                    <input type="number" id="cr_threshold" class="text_pole" min="1" max="999" step="1">
                </div>
                <div class="cr-status" id="cr_status"></div>
                <div class="cr-field">
                    <input id="cr_unlock" class="menu_button" type="button" value="End session (keep card)" title="Escape hatch. Leaves the current card without deleting anything.">
                </div>
            </div>
        </div>
    </div>`;
    $('#extensions_settings').append(html);

    const $enabled = $('#cr_enabled').prop('checked', settings.enabled);
    const $threshold = $('#cr_threshold').val(settings.threshold);

    $enabled.on('change', function () { settings.enabled = $(this).prop('checked'); persist(); });
    $threshold.on('change', function () {
        const v = parseInt($(this).val(), 10);
        settings.threshold = Number.isFinite(v) && v > 0 ? v : DEFAULTS.threshold;
        $(this).val(settings.threshold);
        persist();
        updateButton();
    });
    $('#cr_unlock').on('click', function () {
        if (!settings.lock) { toastr.info('No card in progress.'); return; }
        clearLock();
        toastr.success('Session ended. The card was left in place.', 'Card Roulette');
    });

    refreshStatus();
}

function refreshStatus() {
    const $s = $('#cr_status');
    if (!$s.length) return;
    if (settings.lock) {
        $s.html(`In progress: <b>${nameByAvatar(settings.lock.avatar)}</b>. ${settings.lock.count}/${settings.threshold} messages sent.`);
    } else {
        $s.html('No card in progress.');
    }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
jQuery(async () => {
    const context = ctx();

    // Merge defaults into persisted settings (single live reference).
    if (!context.extensionSettings[MODULE]) context.extensionSettings[MODULE] = {};
    settings = context.extensionSettings[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (settings[k] === undefined) settings[k] = v;
    }

    injectSettings();
    injectButton();

    const { eventSource, eventTypes } = context;
    eventSource.on(eventTypes.MESSAGE_SENT, onMessageSent);
    eventSource.on(eventTypes.CHAT_CHANGED, () => { onChatChanged(); refreshStatus(); });
    eventSource.on(eventTypes.CHARACTER_PAGE_LOADED, injectButton); // re-add if list re-renders
    eventSource.on(eventTypes.APP_READY, restoreLock);

    console.log('[CardRoulette] loaded.');
});
