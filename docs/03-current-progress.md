# Current Progress

Phase 1, single-player core loop. Checked directly against the live repo rather than written from memory, since earlier versions of this document made a couple of claims that turned out not to hold up once actually verified — worth knowing this has been double-checked, not just restated.

## What's working

Combat resolves as a single simultaneous round rather than a back-and-forth exchange — both sides commit to an action blind, and the round plays out in one pass. Surrender always takes priority regardless of what the other side chose, by design, since a surrender that could be overridden by the opponent's own action wouldn't actually be reliable. Only Red cards boost attack; an earlier version of the combat math let a Blue card played during an attack contribute to both a speed hedge and bonus damage at once, which has been fixed. Both defeat and surrender correctly move items between the right sides for player and AI hunters alike.

Zones of control are melee-only and wall-aware, meaning they're computed with genuine line-of-sight rather than raw tile distance, so a wall between a melee hunter and a nearby tile correctly blocks that tile from being threatened. Crossing into a threatened tile triggers a reaction strike right at the point of crossing — the movement animation genuinely pauses there — and then the path continues rather than being blocked outright. A single move only takes one charge per distinct enemy zone it passes through, regardless of how much of that zone it actually crosses. Disengage is a real, repeatable two-AP movement option that's fully immune to zones of control, meant specifically as the deliberate way to leave a threatened area without paying the reaction-strike cost.

Attack ranges differ by class rather than following one universal rule. Melee is adjacent-only and is the only category that projects a zone of control. Ranged requires strict cardinal line-of-sight with zero tolerance for obstruction. Caster reaches in a full omnidirectional diamond and tolerates one obstruction along the way, at reduced damage rather than being blocked outright.

AI hunters run on the exact same `TurnManager` the player uses, spending real AP and playing real cards from a real hand rather than acting through any simplified AI-only path. Three archetypes — Aggressive, Treasure, and Balanced — differ in their movement goals, how readily they're willing to engage a fight, and how they behave once a fight is happening. All three pick the smallest Blue card that actually closes the real distance to their target rather than reflexively burning the largest card in hand regardless of need.

Monsters are a fully separate entity type rather than a reskinned hunter. They have fixed stats determined by tier, no hand, no inventory, and always attack — there's no archetype system governing them the way there is for hunters, and that's intentional rather than an oversight. They spawn at a fifteen percent chance rolled after every individual mercenary's turn, hunter and player alike, capped at five alive on the map at once, and as a group they always act after every hunter has finished their turn for that round regardless of when during the round they actually spawned.

A handful of smaller systems are also genuinely built and working: a persistent, scrollable match log; a hunter-inspection panel showing every hunter's portrait, HP, and public inventory as compact individual cards; a character creation screen with the diminishing-returns stat system and class identity that's now purely mechanical rather than stat-based; a camera that correctly locks during AI and monster turns; real sourced icons on all six nodes of the radial action wheel; and a help scene that, as of right now, is still just a static text page rather than anything interactive.

## Designed but not built

Hiding the exit until the relic has actually been found is still the single strongest lever identified for stopping a fast, evasive build from simply planning an optimal route across both objectives from the very start of a match and winning without ever engaging anyone. It's fully designed and explained in more depth in the development roadmap, but no part of it — the hidden state, the reveal trigger, the UI moment when it happens — has actually been built yet.

Monster frenzy, where monsters are meant to become measurably more dangerous once the relic has been found, is designed but not wired into actual gameplay. The flag it depends on exists on the session object, but nothing in the map logic currently sets it when the relic is found or reads it when computing monster movement, so the mechanic has no observable effect in play right now despite existing in the data model.

A deck-exhaustion boss — some kind of significant threat tied to what happens when the shared deck runs dry — hasn't been designed in real detail yet, let alone built.

The interactive tutorial remains just an idea; the Help scene is still the static page it's always been.

A rework of the Move action's UX has been discussed and designed but not built: entering aim mode immediately using the hunter's base movement stat, with a card becoming an optional way to extend that range afterward rather than a mandatory screen standing in front of aiming at all. This was meant to directly answer a specific playtester complaint about too many steps standing between deciding to move and actually being able to aim.

## Known pain points

The shared deck still doesn't reset between separate matches, which is a confirmed, real bug rather than something that's actually been addressed. The HP bar still treats a knocked-out hunter's reduced ceiling as their full bar rather than showing the true reduction. AI hunters can still Rest more than feels ideal, most likely because the amount restored per Rest is small relative to the threshold that triggers resting rather than because the threshold logic itself is wrong. And discarding the win-condition relic is still fully allowed with no rule or warning attached to it either way.

See `docs/known-issues-and-suggestions.md` for the complete list, including things that were considered and explicitly turned down.
