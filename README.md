# Card Roulette

A SillyTavern extension that forces you back into the character cards you downloaded and forgot about.

Press the dice button and it opens a random card that is **not** in your favorites, then locks you into it. You cannot leave until you have sent a set number of messages (default 8). Try to bail early and it warns you, clearly, that leaving will permanently delete the card. Once you have given the card a fair shot, you decide its fate: Favorite it, Keep it, or Delete it permanently.

The point: rediscover the diamonds buried in your collection, and clear out the duds.

## Install

In SillyTavern, open the **Extensions** panel, click **Install Extension**, and paste this repository's URL:

```
https://github.com/Zoshiao/SillyTavern-CardRoulette
```

That is it. No config files to edit, no server restart, no special permissions. It is a pure UI extension.

## Settings

Found under **Extensions > Card Roulette**:

- **Enabled** - master on/off switch.
- **Messages before you can rate or leave** - how many of your own messages you must send before the card unlocks (default 8).
- **End session (keep card)** - an escape hatch that lets you out of the current card without deleting anything.

## How it works

- Only counts **your** messages toward the threshold (swipes and regenerations do not inflate the count).
- The lock survives a page reload, so reloading is not an escape hatch. Use the escape-hatch button if you genuinely need out.
- Rejecting a card deletes it permanently with **no backup**. If you want to be able to recover a misjudged card, re-download it from wherever you got it.
- Favorited cards are excluded from the random pool, so once you Favorite a card it stops coming up.
- Each roll avoids handing you the exact card you just finished with, when you have other options.

## Notes

This is a personal tool shared as-is. It targets SillyTavern 1.18.x and uses the public extension context (`SillyTavern.getContext()`).
