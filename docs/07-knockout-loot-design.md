# Knockout, Defeat & Surrender

Combat in this game has two genuinely different losing conditions, and they lead to meaningfully different consequences on purpose — being ground down to zero HP in a fight you didn't want to walk away from should feel different from choosing to surrender before it gets that bad, and the mechanics here are built to reflect that difference rather than treating every loss the same way.

## Defeat — HP actually reaching zero

A hunter reduced to zero HP doesn't die outright the way a monster does; they're teleported away from wherever they fell, removed from immediate danger, but the match continues for them. The real consequence is that their HP ceiling is cut to half of their original maximum for the remainder of the match — Resting can still heal them, but only ever back up to that new, reduced ceiling, never past it, so a single bad defeat has a lasting effect on how tanky that hunter can be for the rest of the game rather than being something they simply walk off. If the hunter who did the defeating was another hunter rather than a monster, they steal one item from the loser as a direct consequence of winning the fight. Monsters, by contrast, never steal anything when they win — they have no inventory of their own to receive stolen loot into, so there's nothing for the mechanic to do in that case, and it correctly doesn't try.

## Surrender

Surrender is unconditional by design — it resolves regardless of whatever the other side in the fight chose to do that same round. This was a deliberate choice rather than an accidental gap: surrender is meant to be a genuinely reliable way to opt out of a fight you can see you're going to lose, and if the opponent's own action could somehow override or deny that choice, it would stop being reliable and become a gamble instead, which defeats the entire point of having a surrender option at all.

Surrendering keeps the hunter's current HP exactly as it was at the moment they surrendered — there's no ceiling reduction the way outright defeat causes, since surrendering is meant to be the less punishing of the two ways to lose a fight. The cost instead is an item: the surrendering hunter gives up one item of their choosing, or nothing at all if their inventory happens to be empty. The actual item-picker interface for this choice is still a stub right now — it currently just takes whatever's sitting in the first filled inventory slot rather than letting the player genuinely choose which item to give up, which is a real, known gap between the intended design and what's actually implemented.

## How AI handles both situations

When an AI hunter wins a fight and gets to loot the loser, its priority is straightforward and consistent: if the loser happens to be carrying the match's actual target item, take that specifically; otherwise, take a random item from whatever filled slots are available. When an AI hunter is the one surrendering, the logic runs in the opposite direction — it will never give up the match's target item while it's still holding any other item that could be surrendered in its place, meaning the target item is effectively the last thing an AI hunter will ever part with voluntarily.
