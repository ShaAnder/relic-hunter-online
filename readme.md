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
├── rendering/              hitTest.ts (shared point-in-shape primitives), svgIcon.ts
├── scenes/                 MainMenu → CharacterCreation/Load → Lobby → MissionSelect → Map → MatchResult, Help
├── systems/                  TurnManager (generic over any entity with hand+item traits)
├── types/                      entities.ts (PilotedMercenary, MonsterEntity, MovableToken)
└── ui/
    ├── buttons/                 RadialActionWheel, BagButton, LogButton, InspectButton, RefocusButton
    ├── overlay/                   BattleOverlay, PauseOverlay, LoadingOverlay
    ├── CharacterPanel.ts, DeckTracker.ts, Hand.ts, InventoryPanel.ts, LogPanel.ts, HunterSummaryPanel.ts, PlayZone.ts

shared/src/
├── ai/            mercenaryAI.ts, monsterAI.ts, aiMemory.ts
├── combat/          combat.ts, targeting.ts (line-of-sight geometry), zoneOfControl.ts
├── cards/             card.ts, deck.ts
├── entities/            character.ts, chest.ts, monsterSpawning.ts
├── items/                  item.ts
├── world/                    generation.ts, grid.ts (now also owns isAdjacent), movement.ts
├── math/                       random.ts
└── types/                        entity.ts (EntityCore + composable traits), mercenary.ts, monster.ts
```

## Architecture Notes

**Every game entity is built from composition, not inheritance.** `shared/types/entity.ts` defines `EntityCore` (`id`, `coord`, `stats`, `currentHp` — genuinely every entity has this, no exceptions) plus three independent traits: `HasHand`, `HasItems`, `HasCharacterClass`. `MercenaryState` is `EntityCore & HasHand & HasItems & HasCharacterClass` — an intersection type, not a class hierarchy. `MonsterState` is `EntityCore & { tier }` — genuinely minimal, no hand, no items, not faked. `TurnManager` is generic over any entity with the hand+item traits, not hardcoded to hunters specifically — a future entity type (a boss, say) could compose whatever subset of traits it actually needs without touching this class at all.

**Every hunter, human or AI, is the same shape.** `MapScene` holds one `units: PilotedMercenary[]` array — `pilot: "local" | "ai"` is the only thing distinguishing a human-controlled unit from an AI one. Each owns its own real `TurnManager` — AI genuinely spends AP and hand cards rather than acting for free.

**Monsters fight through the exact same `BattleOverlay` every hunter fight uses**, via a `monsterAsMercenaryState` adapter — a deliberate, still-in-place bridge, not fully removed (the risk of removing it runs through `BattleOverlay.finishBattle`'s defeat/loot branch, which assumes every combatant can be revived/looted like a hunter; scoped out of this session's rebuild on purpose). `BattleOverlay` does correctly special-case monsters where it matters most: `isAttackerMonster` forces `monsterCombatChoice` (always Attack, never Defend/Run/Surrender) instead of the normal archetype-weighted decision, and a defeated monster attacker dies outright (`attackerMonsterDied` result flag) rather than going through the hunter knockout-revival path.

**Combat range is archetype-specific geometry, not a single rule.** Melee is adjacent-only and projects a Zone of Control; Ranged requires strict cardinal line-of-sight with zero tolerance for full damage; Caster reaches an omnidirectional diamond with one tolerated obstruction at reduced damage.

**Zones of Control are wall-aware and don't stop movement.** Entering a threatened tile never halts a path — it triggers a reaction strike and continues. AI engagement decisions use the hunter's _pre-approach_ HP specifically, so a ZoC tick taken reaching a target can't retroactively cancel the fight it was risked for — the post-move HP is still what the retreat/rest fallback correctly uses if no fight happens.

**Character stats have no class bonuses anymore.** Every class starts at the same numeric floor (`UNIVERSAL_BASE`); class identity is entirely mechanical (Summoner summons, Ranged/Caster attack from range, Melee projects ZoC) rather than a stat-block difference — deliberately, since a class bonus was directly undermining the diminishing-returns cost curve (a class starting with free movement partially opts out of the escalating cost meant to discourage over-investing in one stat). Movement escalates in cost every point; Attack/Defense every two; HP every three.

**Camera behavior is now fully state-aware.** Pan and zoom are both genuinely disabled during AI/monster turns (`Camera.setInputLocked`), not just narrowed — closing a real gap where held input could sneak through during the brief window between individual units' turns. A `RefocusButton` lets the player manually recenter at any time; `beginPlayerTurn()` is a named hook for "it's now the player's turn" camera behavior, deliberately not coupled to "the AI/monster phase just ended," since that assumption only holds because the player currently always goes first.

## Getting Started

```bash
npm install
npm run dev
```

## Controls (MapScene)

| Input                          | Action                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| WASD                           | Pan camera (player turn only)                                 |
| Mouse wheel                    | Zoom (player turn only)                                       |
| Hover/tap near hand            | Reveal cards                                                  |
| Drag a card onto PlayZone      | Confirm that card                                             |
| Click hub / ring nodes         | Move, Attack (opens range overlay), Rest, Disengage, End Turn |
| Click an enemy while targeting | Attack them, if in range                                      |
| Click refocus button           | Recenter camera on your own character                         |
| Esc                            | Cancel current mode, or open Pause                            |
| R                              | Regenerate map (dev shortcut)                                 |

## Current Status

**Phase 1 — Single-player core loop, deep into a full entity-architecture rebuild plus AI/combat correctness fixes.** This session's major work: a composition-based entity rebuild across `shared/` and `client/` (real trait-based types replacing hand-duplicated, overlapping ones), a character-creation overhaul (class stat bonuses removed, diminishing-returns cost curve, unified class/model picker with real flavor + purpose text per class), a full camera rework (input locking, monster-turn tracking, refocus button), and several confirmed AI/combat bugs fixed (monster surrender/defend bug, monster-death-instead-of-revival bug, ZoC-flee-immediately-after-approach bug).

See `docs/known-issues-and-progress.md` for the full current bug list and in-progress items.
