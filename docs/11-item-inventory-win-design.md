# Items, Inventory & Win Condition

## Item categories, and what each is actually for

There are three categories of item, and they exist for meaningfully different purposes rather than just being a flavor distinction. The Relic is the single win-condition item for a given match — there is always exactly one per match, and finding it and getting it out is the entire objective the rest of the game is built around. Loot covers general pickups that exist for their own sake, worth collecting toward the compendium described below even when they have no direct mechanical effect on the current match. Gear covers dedicated Weapon, Armor, and Accessory slots, though right now those slots exist as empty placeholders with no actual stat effects attached — the intent is clearly there in the inventory's structure, but the content that would make Gear meaningful hasn't been built yet.

**Worth flagging directly**: this document describes a nine-slot inventory, and that description hasn't been independently re-verified against the actual live `MercenaryState`/`InventoryPanel` code as of this rewrite. Other systems built this session — the monster-to-hunter adapter used for combat, specifically — assume a flat six-slot inventory with no gear/general split. If the real inventory genuinely has the nine-slot structure described below, that adapter code may currently be subtly wrong. This needs an actual check against the live code rather than being resolved by assumption in either direction.

## Inventory layout as designed

The inventory has nine slots total: three of them are fixed Gear slots — one each for Weapon, Armor, and Accessory — currently inert since gear has no stat effects yet, and six are general-purpose slots holding both Relic and Loot items interchangeably. Picking up an item is fully automatic; walking onto it adds it to inventory with no confirmation step or player input required. If all six general slots happen to be full at the moment a hunter walks over an item, the item simply stays where it is on the ground rather than prompting any kind of swap-or-discard decision — there's no forced choice moment built into pickup right now.

## The win condition, and a deliberate non-obvious rule within it

Winning requires a hunter to be standing on the Exit tile while physically holding the match's Relic, having arrived there through a normal Move action specifically. The Blue **E** card is worth calling out on its own here, because its interaction with the win condition is easy to get wrong if you're reasoning about it casually: playing the E card does *not* trigger a win, even if the hunter playing it happens to already be holding the relic and even though it does move them directly to the exit tile. It only teleports them there and then bounces them onward to a random tile elsewhere on the map. This is explained in more depth in the card system document, but it's worth restating here specifically because the temptation to assume "reaching the exit tile equals winning, regardless of how you got there" is a natural one, and the actual rule is more specific than that.

## The compendium

An item only unlocks permanently in the compendium if it's genuinely still sitting in a hunter's inventory at the exact moment they win the match — anything dropped, lost in combat, surrendered, or simply left behind at any earlier point in the run doesn't count toward unlocking it, even if it was picked up and carried for most of the match before being lost. This creates a real incentive to actually hold onto interesting items rather than just glancing at them, since a near-miss doesn't count for anything. Right now this only applies to the Relic and Loot categories, since Gear doesn't have real content yet for the compendium to meaningfully track.

## Match result screen

Currently shows whether the match was won or lost, how many turns it took, and how many items were successfully extracted, with a single button returning the player to the Lobby. Deeper post-match statistics — anything more granular than this — are planned but not designed in detail or built yet.
