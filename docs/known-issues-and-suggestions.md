# Known Issues & Suggestions

Last reconciled: 2026-08-21 (post movement drag+confirm; cancel/re-enter paths simplified).

## Still open

### Multi-monitor / resize layout
HUD is corner-anchored from `app.screen` width/height. If panels drift after dragging the window between monitors, defer layout one frame in `Game.handleResize` (`requestAnimationFrame`) so Pixi has updated `screen` before `layoutHud` runs.

### Combat AI — objective context not wired
`CombatAiContext` already supports `exitDistance`, `carrierDistance`, and `carryingRelic` for tactical surrender / extract scoring. BattleOverlay may still omit real values from MapScene. Core scored Attack/Defend/Run/Surrender works; warp/objective bias is incomplete until those fields are passed.

### Dual-defend tuning (soft)
Healthy-hunter attack bias was raised to reduce AI-vs-AI mutual Defend. If playtests still show frequent turtle trades (especially balanced/treasure), nudge `attackBase` upward again — tuning, not a logic bug.

## Fixed this cycle (summary)

- Shared deck reset on match start
- Exit on relic find + chest spread placement
- HP ceiling visuals (CharacterPanel, HunterSummary, BattleOverlay)
- AI rest threshold ~0.25; relic discard blocked
- AI extract + sticky `extracting`; CombatAiContext scored combat actions
- Battle `blocksEscape`; monsters do not receive loot
- Surrender/defeat loot softlock (popup parenting, Take vs Give)
- **Player movement:** drag-authored path, dynamic remaining range from tip, lock on release, **confirm only by clicking locked destination**; other in-range click/drag replaces path; right-click clears path without full exit spam issues

## Closed / no longer tracked

- **Move re-enter after Esc** — cancel/exit paths for move mode were simplified; this softlock path is not in the current control scheme.
- **Click-target left bias** — deprioritized: drag-to-path means destination is authored along the route rather than single-tile click-to-commit. Revisit only if drag sampling itself feels offset.

## Suggestions (backlog)

- Wire live exit/carrier distances into combat AI context
- Combat system rebuild (sequential resolution, etc.) — next major pass
- Always-visible relic holder indicator
- Passive item value; fake/decoy exit; interactive tutorial
- Equal-cost path alternates for AI (player already authors path by drag)

## Explicitly not bugs

- Random teleport on surrender/knockout (by design)
- AI using pathfinding helpers while player uses drag-authored paths
