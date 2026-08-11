# Turn & AP System

Every unit capable of acting on the map — the player, and every individual AI-controlled hunter — owns a genuine, independent `TurnManager` instance. This is worth stating plainly because it would have been easy, and much less work, to give AI hunters a lighter, simplified version of turn logic that just approximates what the player experiences. That's explicitly not what happens here: an AI hunter that runs out of AP mid-turn is exactly as stuck as the player would be in the same situation. There's no privileged path for AI to bypass the resource system the player is bound by.

## The base rules, and why they landed where they did

Every hunter gets three AP as a baseline per turn. Moving costs one AP, attacking costs two, resting costs one, and Disengaging — the ZoC-immune alternative movement described in the zones-of-control document — costs two. The Summoner class, once actually built, will get four AP instead of three as part of its whole identity being built around action economy and pet management rather than personal combat strength.

The rule that spending an action doesn't lock out movement afterward is a genuinely deliberate, and fairly recently settled, design choice rather than something that's always been true. An earlier version of the turn system had actions and movement compete more directly for a hunter's turn — spend an action, lose the ability to move afterward that turn. That got reworked specifically because it was adding friction without adding an interesting decision: a hunter choosing to rest shouldn't be artificially prevented from also repositioning afterward if they have the AP for both, since that's not really a meaningful tactical trade-off, just an arbitrary restriction. Under the current system, a hunter can genuinely move and then act, or act and then move, in whichever order the situation actually calls for, as long as the AP math works out.

Disengage gets its own two-AP price tag specifically because it's meant to be a real, deliberate choice to prioritize survival over anything else that turn — it's expensive enough that a hunter can't casually Disengage every single turn on top of a full slate of other actions, but it's cheap enough relative to its immunity to zones of control that it's genuinely worth choosing when the situation calls for it.

## Drawing cards

Every turn starts with one automatic card draw, no action or AP cost required — this happens as part of simply beginning the turn. Choosing to Rest layers two more draws on top of that, alongside healing a percentage of the hunter's current HP ceiling (the exact mechanics of that healing, and how the ceiling itself can shrink after a knockout, are covered in the knockout-and-loot document). Every single one of these draws, whether it's the automatic turn-start draw or the Rest bonus, comes from the one shared match deck described in the card system document — there's no separate personal deck anywhere in this system.

## How this actually plays out for AI

Because AI hunters use the literal same `TurnManager` class as the player rather than a parallel implementation, every constraint described above applies to them exactly as written. An AI hunter deciding whether it can afford to attack this turn is asking the same question, against the same AP pool, using the same code path the player's own UI is built on top of. This matters more than it might initially seem to, because it means any future rebalancing of AP costs, or any new action added to the system, automatically applies correctly to AI without needing a second, parallel implementation to keep in sync.
