# Relic Hunter Online

A browser-based tactical multiplayer game inspired by the 1999 classic _Battle Hunter_, evolved with Final Fantasy Tactics-style depth. Players compete as hunters on an isometric grid, drawing from a shared card deck to move, fight, defend, and set traps while racing to find and extract a target item before anyone else — while non-hunter monsters roam and hunt everyone indiscriminately.

---

## Tech Stack

PixiJS v8 (rendering), Colyseus (planned networking), Supabase (planned auth/persistence), Vite + TypeScript, npm workspaces (`client/`, `shared/`).

## Project Structure

```
client/src/
├── core/           scenes, overlays, camera, game bootstrap, session state
├── debug/           debug-only test entities, never imported outside dev paths
├── entities/          Card, Chest, Mercenary, Monster (MonsterToken class) — visual tokens
├── math/                iso projection, easing
├── scenes/                 MainMenu → CharacterCreation/Load → Lobby → MissionSelect → Map → MatchResult, Help
├── systems/                  TurnManager (AP economy — shared by player and every AI unit), MoveController
├── types/                      client-side cross-file types (PilotedMercenary, MonsterEntity)
└── ui/
    ├── buttons/                 RadialActionWheel, BagButton, LogButton
    ├── overlay/                   BattleOverlay, PauseOverlay, LoadingOverlay
    ├── CharacterPanel.ts, DeckTracker.ts, Hand.ts, InventoryPanel.ts, LogPanel.ts, PlayZone.ts

shared/src/
├── ai/            mercenaryAI.ts, monsterAI.ts, aiMemory.ts
├── combat/          combat.ts, targeting.ts (line-of-sight geometry), zoneOfControl.ts
├── cards/             card.ts, deck.ts
├── entities/            character.ts, chest.ts, monsterSpawning.ts
├── items/                  item.ts
├── world/                    generation.ts, grid.ts, movement.ts
├── math/                       random.ts
└── types/                        mercenary.ts, monster.ts
```

Reorganized this session from a flat `game/` catch-all into genuine domain folders — every file in `client/` imports exclusively through the `@relic-hunter/shared` barrel, so this required zero changes outside `shared/` itself.

## Architecture Notes

**Every hunter, human or AI, is the same shape.** `MapScene` holds one `units: PilotedMercenary[]` array — `pilot: "local" | "ai"` is the only thing distinguishing a human-controlled unit from an AI one. Each owns its own real `TurnManager`, the same class, same AP gates, same card economy — AI genuinely spends AP and hand cards rather than acting for free.

**Monsters are a deliberately separate, smaller entity type.** No hand, no items, no pilot concept — just set stats per tier (light/medium/heavy). They still fight through the exact same `BattleOverlay` every hunter fight uses, via an adapter presenting them as an empty-handed `MercenaryState`, rather than a second combat system.

**Combat range is archetype-specific geometry, not a single rule.** Melee is adjacent-only and projects a Zone of Control; Ranged requires strict cardinal line-of-sight with zero tolerance for full damage; Caster reaches an omnidirectional diamond with one tolerated obstruction at reduced damage. `shared/combat/targeting.ts` owns the actual raycast (Bresenham's line algorithm) both the attack-range overlay and combat-initiation legality read from.

**Zones of Control are wall-aware and don't stop movement.** Entering a threatened tile never halts a path — it triggers a reaction strike (visibly, the move animation pauses at the crossing point) and continues. Disengage is the real alternative: 2 AP, fully immune, repeatable as AP allows.

## Getting Started

```bash
npm install
npm run dev
```

## Controls (MapScene)

| Input                          | Action                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| WASD                           | Pan camera                                                    |
| Mouse wheel                    | Zoom                                                          |
| Hover/tap near hand            | Reveal cards                                                  |
| Drag a card onto PlayZone      | Confirm that card                                             |
| Click hub / ring nodes         | Move, Attack (opens range overlay), Rest, Disengage, End Turn |
| Click an enemy while targeting | Attack them, if in range                                      |
| Esc                            | Cancel current mode, or open Pause                            |
| R                              | Regenerate map (dev shortcut)                                 |

## Current Status

**Phase 1 — Single-Player Core Loop, deep into combat/AI depth.** The core loop, Zones of Control, archetype-specific combat ranges, a shared AP economy for AI, monsters as a real entity category, and a persistent match log are all built and verified against the actual repo this session. Two small orphaned files identified and pending deletion (see `docs/03-current-progress.md`). Today's focus: a pass on outstanding bugs, an interactive tutorial mode to replace the current static `HelpScene`, and a legibility pass on the UI's icon set.
