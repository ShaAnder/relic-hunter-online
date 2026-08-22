# Current Progress

Phase 1, single-player core loop. Fully reconciled 2026-08-22 — every claim below checked directly against the live repo in this pass.

## What's working

Combat resolves as a single simultaneous round. Zones of control are melee-only, wall-aware, and reaction strikes now correctly account for a defender's temporary defense bonus (including full immunity from an "A" card) via the same shared bonus system Movement and Defense cards both feed. **Both ZoC's scope and the whole resolution model are scheduled to change significantly in the upcoming combat rework** — see `14-combat-rework-design.md`.

Attack ranges differ by class. **Also scoped to change in the rework** — ranged is planned to move away from being a direct damage source entirely, toward debuff/setup abilities instead.

AI hunters run on the same `TurnManager` the player uses. Three archetypes — Aggressive, Treasure, Balanced — differ in movement goals and engagement willingness. Combat choices are scored through `CombatAiContext`, though its objective-awareness fields (exit/carrier distance) are still never fed real data — deliberately left for after the rework.

Monsters are a fully separate entity type. Regular monsters spawn at 15% between individual turns, capped at five, act as a group after every hunter. **Monster frenzy is now fully wired** — the moment the relic is found, every living regular monster gets a real, permanent movement and attack bump.

**The deck-exhaustion boss is fully built.** A unique entity outside the normal light/medium/heavy tier system — deliberately stronger and faster than heavy rather than following the tier progression, no spawn roll, no cap, spawns exactly once, the round the shared deck genuinely empties. Always acts last in the turn order, after every hunter and every regular monster has gone that round. The spawn moment itself is a real sequenced event: a flashing red warning alert, overlapping with camera shake and boss theme music starting together, then a genuine camera pan to the boss's actual spawn location, then a deliberate pause before its own first turn begins. Two real design decisions for how the boss's presence should further affect AI behavior and what happens if it kills the relic carrier specifically are captured as notes, not yet built — see `09-enemy-ai-design.md`.

Player movement is a genuine drag-authored path system. The exit tile doesn't exist anywhere on the map until the relic is actually found, then spawns dynamically, deliberately far from the find location. Chest placement uses the same spread-aware logic.

The relic cannot be dropped from inventory — enforced via an active confirm popup explaining why, rather than a silently disabled button. The battle/loot overlay's Escape-key dismissal is correctly blocked mid-fight, and the loot-confirmation softlock is fixed.

**Camera handling is substantially hardened.** The catapult bug is fully fixed. Free panning is bounded to the map's actual diamond-shaped isometric extent. Multi-monitor/DPI resize now correctly listens to the renderer's own resize event rather than the unreliable generic `window.resize`. Camera gained a genuine `shake()` method, same Ticker-driven pattern as `panTo`.

**A rough audio system exists** — minimal play/stop, no preloading or crossfading, built specifically to test whether music timing works for the boss sequence. Not a real audio system yet.

A handful of smaller systems remain genuinely built and working: a persistent scrollable match log, a hunter-inspection panel, character creation with diminishing-returns stat costs, real sourced icons on the radial action wheel, and a Help scene that is still just a static text page.

## Designed but not built

The full combat rework — 3-round sequential resolution, a new Special action category, ranged classes becoming debuff/setup tools, zones of control narrowing to Brawler with Tank getting its own future defensive special — is fully designed in `docs/14-combat-rework-design.md`. This is tomorrow's planned work, alongside the range/ZoC changes it depends on.

Two boss-related design notes, not yet built: AI hunters should gain a strong bias toward finding the relic and extracting once the boss spawns, with Aggressive specifically staying more willing to engage but weighing nearby loot over a fight when the loot is genuinely closer; and the boss defeating the relic carrier specifically should end the match as an immediate, absolute loss, distinct from every other defeat consequence in the game, which currently all use the same stay-down-and-recover model. Both captured in full in `09-enemy-ai-design.md`.

Tutorial levels / an interactive onboarding flow — still just an idea, still the last major piece planned before this phase is considered feature-complete, per tonight's stated sequencing: combat rework first, then tutorials.

## Known pain points

See `docs/known-issues-and-suggestions.md` for the complete, currently-accurate list. The one worth flagging most directly here: the `try/finally` guard identified after tonight's real full-game hang (a synchronous error during boss spawning silently killed the rest of the turn sequence, leaving the game permanently locked) was designed but never actually applied to `processEnemyTurns` — the specific bug that caused that exact hang is fixed, but the general protection against the *next* one isn't in yet.
