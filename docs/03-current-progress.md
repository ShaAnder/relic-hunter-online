# Current Progress

Phase 1, single-player core loop. Fully reconciled 2026-08-21 — every claim below checked directly against the live repo in this pass, replacing an earlier version of this document that had gone stale enough to contradict its own most recent update section.

## What's working

Combat resolves as a single simultaneous round — both sides commit to an action blind, and the round plays out in one pass. Surrender always takes priority regardless of what the other side chose. Both defeat and surrender correctly move items between the right sides, and monsters are explicitly blocked from ever receiving items either way — checked in both directions.

Zones of control are melee-only and wall-aware. Crossing into a threatened tile triggers a reaction strike right at the crossing point, then the path continues. A single move only costs one charge per distinct zone crossed, however much of it is actually traversed. Disengage remains a repeatable, fully ZoC-immune movement option. **This whole system is scoped to change significantly in the upcoming combat rework** — see `14-combat-rework-design.md` — narrowing from all melee classes to Brawler specifically, with Tank getting a separate defensive special later.

Attack ranges differ by class — Melee adjacent-only (the only category that projects a zone of control), Ranged strict cardinal line-of-sight, Caster an omnidirectional diamond tolerating one obstruction at reduced damage. **Also scoped to change in the rework** — ranged is planned to move away from being a direct damage source entirely, toward debuff/setup abilities instead.

AI hunters run on the same `TurnManager` the player uses, spending real AP and playing real cards. Three archetypes — Aggressive, Treasure, Balanced — differ in movement goals and engagement willingness. AI now has genuine extraction behavior — a sticky `extracting` flag in AI memory — and combat choices are scored through `CombatAiContext` (Attack/Defend/Run/Surrender weighed with a small randomizing jitter), rather than simple fixed rules. Objective-aware context (exit distance, carrier distance, whether the AI itself is carrying the relic) is defined in the scoring system but not yet fed real values from the map — see Known Issues.

Monsters are a fully separate entity type — fixed stats by tier, no hand, no inventory, always attack, no archetype system. Spawn at 15% between individual turns, capped at five, always act after every hunter in the round.

Player movement is a genuine drag-authored path system, not click-to-target. Drag traces a legal route within budget (cardinal, walkable, in-range); releasing locks the path; committing only happens by clicking the locked destination tile again. Remaining movement range recalculates dynamically from the path's current tip as it's being drawn. Right-click clears the in-progress path without exiting move mode or losing the spent action — a direct fix for an earlier Escape-key softlock in the old click-to-target system, which no longer exists as a control scheme.

The exit tile doesn't exist anywhere on the map until the relic is actually found — not hidden, genuinely absent from the grid data (`TileType.Floor` until converted). Once found, it spawns dynamically, deliberately far from wherever the relic was picked up (`pickExitFarFrom`, with a real fallback if no sufficiently-far tile exists), rather than reappearing at a fixed pre-generated location. Chest placement uses the same spread-aware logic (`pickSpreadWalkableTile`) rather than pure random placement, directly addressing the earlier playtest finding of trivially-easy wins from relic-near-spawn seeds.

The shared card deck resets fully at the start of every match. HP bars across all three UI surfaces (character panel, hunter summary, battle overlay) correctly show a knocked-out hunter's true original maximum, not their reduced post-knockout ceiling. AI hunters rest at a genuinely tuned threshold (0.25 HP ratio) rather than the earlier, too-generous 0.5. The relic cannot be dropped from inventory — currently enforced by disabling the drop button outright for that specific item, with a clearer active confirm-popup version designed but not yet applied.

The battle/loot overlay's Escape-key dismissal is correctly blocked mid-fight (`blocksEscape`), and the earlier softlock where a pending loot confirmation could leave the game stuck is fixed — closing the overlay for any reason now correctly resolves whatever loot decision was pending rather than leaving it hanging.

Camera handling is substantially hardened this session: the camera-catapult bug (right-click stealing keyboard focus, causing a key to appear permanently held) is fully fixed, including a resurgence that needed a second pass to close a gap where the fix only covered right-clicks inside the game canvas specifically. Free panning is now bounded to the map's actual diamond-shaped isometric extent, computed in tile space rather than a naive axis-aligned box. Multi-monitor/DPI resize handling has a confirmed root cause and fix identified — not yet applied, see Known Issues.

A handful of smaller systems remain genuinely built and working: a persistent scrollable match log, a hunter-inspection panel, character creation with diminishing-returns stat costs, real sourced icons on the radial action wheel, and a Help scene that is, honestly, still just a static text page.

## Designed but not built

Monster frenzy — monsters becoming measurably more dangerous once the relic is found — remains fully unwired. `relicFound` is set correctly when the relic is found, but nothing in monster AI logic reads it anywhere; the mechanic has zero observable effect in play.

A deck-exhaustion boss hasn't been designed in real detail yet.

The interactive tutorial remains just an idea.

The full combat rework — 3-round sequential resolution, a new AP-costed Special action category (separate from Attack/Rest, doesn't trigger the Move-lock), ranged classes becoming debuff/setup tools instead of direct damage, zones of control narrowing to Brawler with Tank getting its own future defensive special — is fully designed in `docs/14-combat-rework-design.md`. This is the next major scheduled pass.

## Known pain points

See `docs/known-issues-and-suggestions.md` for the complete, currently-accurate list. Highlights: the multi-monitor resize bug has a confirmed root cause and fix, not yet applied. The relic-discard block works but via a less clear mechanism than intended. Trap hazard rolls never actually receive a card even though the underlying function supports one. The surrender item-picker still shows the wrong icon. Combat AI's objective-awareness fields exist but are never fed real data — deliberately left unresolved pending the combat rework, which is likely to restructure the system that would consume them anyway.
