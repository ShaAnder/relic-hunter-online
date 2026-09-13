# Relic Hunter Online

A browser-based tactical multiplayer game inspired by the 1999 classic _Battle Hunter_, evolved with Final Fantasy Tactics-style depth. Players compete as hunters on an isometric grid, drawing from a shared card deck to move, fight, defend, and set traps while racing to find and extract a target item before anyone else — while non-hunter monsters roam and hunt everyone indiscriminately.

---

## Tech Stack

PixiJS v8 (rendering), Vite + TypeScript, npm workspaces (`client/`, `shared/`, `server/`).

Colyseus and Supabase are installed as client/server dependencies and the `server/` workspace exists (Colyseus server deps declared)

## Project Structure

```
client/src/
├── core/
│   ├── audio/               AudioService, audio manifest
│   ├── cameras/              CameraController, TurnCamera
│   ├── entities/               CharacterRepo (local-storage persistence, Supabase-ready interface)
│   ├── game/                     Game bootstrap, GameSession (all cross-scene state)
│   ├── overlays/                   Overlay base, OverlayManager
│   └── scenes/                       Scene base, SceneManager
├── combat/                BattleController, BattleHost, buildBattleRequest
├── entities/                Card, Chest, Mercenary, Monster (MonsterToken class), CharacterSprite — visual tokens
├── hud/                       MapHud
├── input/                       GestureRouter
├── math/                          iso projection (isoGridMath — grid/screen conversion, elevation, staircase climb), easing, character direction, map shapes, ui scale
├── rendering/                        MapRenderer (tile diamonds, elevation, fog, wall-occlusion fade, staircase visuals), HitTest, SvgIcon, characterSprites
├── scenes/                             LandingScene → MainMenu → CharacterCreation/LoadGame → Lobby → MissionSelect → Map → MatchResult; Settings, Tutorial
├── systems/                               TurnManager (generic over any entity with hand+item traits), MapController, MonsterSystem, ChestSystem, MoveController, TrapSystem, ExitRelicSystem, AiTurnController, TargetingVisuals, ZoneQuery, TutorialMarkers, InputHandler
├── tutorial/                                 tutorialRunner, scripted movement/combat walkthroughs
├── types/                                       entities.ts (PilotedMercenary, MonsterEntity, MovableToken), characterSprite.ts
└── ui/
    ├── buttons/                                   ActionMenu, CombatActionMenu, BagButton, LogButton, InspectButton, RefocusButton
    ├── overlay/                                     BattleOverlay, PauseOverlay, LoadingOverlay, DialogueOverlay, SettingsOverlay
    ├── generics/                                      Button, Slider
    └── CardDrawQueue.ts, CharacterPanel.ts, DeckTracker.ts, Hand.ts, InventoryPanel.ts, LogPanel.ts, HunterSummaryPanel.ts, PlayZone.ts, AudioSettingsPanel.ts, portraits.ts

shared/src/
├── ai/            mercenaryAI.ts, monsterAI.ts, aiMemory.ts, zocPathing.ts
├── combat/          combat.ts, targeting.ts (line-of-sight geometry), zoneOfControl.ts
├── cards/             card.ts, deck.ts
├── entities/            character.ts, chest.ts, monsterSpawning.ts, classSpecials.ts, names.ts, traps.ts
├── items/                  item.ts
├── world/
│   ├── grid.ts                Grid, TileType, coord helpers
│   ├── FogOfWar.ts               three-tier fog model (visible/explored/unseen)
│   ├── movement.ts, placement.ts
│   └── maps/                       alleywaysMap.ts (blueprint compiler + elevation), alleywaysMapBlueprint.ts / alleywaysMapFloor2Blueprint.ts (the hand-drawn map data), alleywaysFloors.ts (multi-floor compile + staircase links), staircaseClusters.ts (climb direction/progress)
├── math/                              random.ts, dice.ts
└── types/                                entity.ts (EntityCore + composable traits), mercenary.ts, monster.ts, matchState.ts
```

## Architecture Notes

**Every game entity is built from composition, not inheritance.** `shared/types/entity.ts` defines `EntityCore` (`id`, `coord`, `stats`, `currentHp` — genuinely every entity has this, no exceptions) plus three independent traits: `HasHand`, `HasItems`, `HasCharacterClass`. `MercenaryState` is `EntityCore & HasHand & HasItems & HasCharacterClass` — an intersection type, not a class hierarchy. `MonsterState` is `EntityCore & { tier }` — genuinely minimal, no hand, no items, not faked. `TurnManager` is generic over any entity with the hand+item traits, not hardcoded to hunters specifically.

**Every hunter, human or AI, is the same shape.** `MapScene` holds one `units: PilotedMercenary[]` array — `pilot: "local" | "ai"` is the only thing distinguishing a human-controlled unit from an AI one. Each owns its own real `TurnManager`.

**The map is a single hand-drawn design now, not procedural generation.** Earlier procedural systems (a room-and-corridor dungeon generator, an alley-network-and-building generator) were tried and removed entirely — pre-drawn maps turned out to be the more reliable approach. The current map ("alleyways") is authored as a color-coded grid image, hand-extracted into a TypeScript blueprint array (`alleywaysMapBlueprint.ts`), and compiled at load time by `alleywaysMap.ts` into a real `Grid` plus a full per-tile elevation model. `MissionSelectScene` no longer has a map-type picker — there's one map, and the flow is closer to a confirmation screen now, ready to grow back into a real picker if a second hand-drawn map is added.

**Elevation is a first-class, per-tile property, not just visual.** Every tile carries a height value: plain street floor is 0, pavement and building interiors sit at 0.1, low walls at 0.5 (crossable, costs extra movement, doesn't block sight), full walls/fences/glass at 1.0+ (impassable by default). Fence and glass are the deliberate exception where transparency is tracked independently of height — full-height but still see-through. `MapRenderer` renders this height directly: tiles are drawn as raised 3D blocks with shaded side faces, not flat diamonds, and entities (`Mercenary`, `MonsterToken`, `Chest`) rise to match the tile they're standing on via `gridToScreenElevated` in `isoGridMath.ts`.

**Multi-floor maps exist via staircases, not a "level select."** `alleywaysFloors.ts` compiles every floor blueprint together and links staircases purely by matching coordinates — a stairs tile at (x,y) on one floor connects to a stairs tile at the same (x,y) on the next floor, if one exists there; not every staircase needs a match, and none of this requires a hand-authored link table. `staircaseClusters.ts` groups a floor's stairs tiles into connected clusters and infers each cluster's climb direction from its own shape (wider-than-tall reads left-to-right, taller-than-wide reads south-to-north — a stand-in until per-tile directions are authored explicitly). Only reaching the actual top tile of a cluster's climb triggers `MapScene.switchFloor`, which swaps the active grid, elevation, and fog data and teleports the local player across. This is scoped to the local player only right now — AI units don't follow between floors. Movement _cost_ for the 0.5-elevation tier (the "extra move to vault a low wall" rule) is elevation data only so far, not yet wired into `computeMovementRange`, which is still a uniform-cost search shared by player and AI pathing.

**A character visually climbing a staircase is orientation-aware, not a flat pixel offset.** Isometric projection already moves screen position with grid position on its own — for a horizontal (left-to-right) staircase, each step right also drops the tile on screen from the projection itself, which very nearly cancels a naive climb effect. `isoGridMath.ts` computes the climb per cluster: canceling that isometric drop exactly (proportional to the cluster's own length) for horizontal climbs, plus a small constant rise for visibility; vertical climbs already rise correctly from the projection alone and just get the same small constant.

**A local player standing behind a tall wall fades it, rather than being hidden behind it.** Characters are rendered always-on-top of tiles, so a raised full-height wall would otherwise visually cover a character that should read as occluded. `MapRenderer.updateWallOcclusion` fades nearby tall walls in a radius centered on the local player's live (mid-animation) screen position — strongest right at the player, fading to no effect at the radius edge — rather than a full depth-sort of tiles against character sprites. Scoped to the local player's own camera view only.

**Monsters fight through the exact same `BattleOverlay` every hunter fight uses**, via a `monsterAsMercenaryState` adapter — a deliberate, still-in-place bridge, not fully removed. `BattleOverlay` does correctly special-case monsters where it matters most: `isAttackerMonster` forces `monsterCombatChoice` (always Attack, never Defend/Run/Surrender) instead of the normal archetype-weighted decision, and a defeated monster attacker dies outright rather than going through the hunter knockout-revival path.

**Combat range is archetype-specific geometry, not a single rule.** Melee is adjacent-only and projects a Zone of Control; Ranged requires strict cardinal line-of-sight with zero tolerance for full damage; Caster reaches an omnidirectional diamond with one tolerated obstruction at reduced damage.

**Zones of Control are wall-aware and don't stop movement.** Entering a threatened tile never halts a path — it triggers a reaction strike and continues. AI engagement decisions use the hunter's _pre-approach_ HP specifically, so a ZoC tick taken reaching a target can't retroactively cancel the fight it was risked for.

**Character stats have no class bonuses.** Every class starts at the same numeric floor (`UNIVERSAL_BASE`); class identity is entirely mechanical (Summoner summons, Ranged/Caster attack from range, Melee projects ZoC) rather than a stat-block difference. Movement escalates in cost every point; Attack/Defense every two; HP every three.

**Camera behavior is fully state-aware.** Pan and zoom are both genuinely disabled during AI/monster turns (`Camera.setInputLocked`). A `RefocusButton` lets the player manually recenter at any time; `beginPlayerTurn()` is a named hook for "it's now the player's turn" camera behavior, deliberately not coupled to "the AI/monster phase just ended," since that assumption only holds because the player currently always goes first.

## Getting Started

```bash
npm install
npm run dev
```

## Controls (MapScene)

| Input                          | Action                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WASD                           | Pan camera (player turn only)                                                                                                                                           |
| Mouse wheel                    | Zoom (player turn only)                                                                                                                                                 |
| Hover/tap near hand            | Reveal cards                                                                                                                                                            |
| Drag a card onto PlayZone      | Confirm that card                                                                                                                                                       |
| Click hub / ring nodes         | Move, Attack (opens range overlay), Rest, Disengage, End Turn                                                                                                           |
| Click an enemy while targeting | Attack them, if in range                                                                                                                                                |
| Click refocus button           | Recenter camera on your own character                                                                                                                                   |
| Esc                            | Cancel current mode, or open Pause                                                                                                                                      |
| R                              | Dev shortcut: reset chests/units/hands locally without a full reload (the map itself is fixed now, so this no longer regenerates a layout — see MapScene.regenerateMap) |

## Current Status

**Phase 1 — single-player core loop, deep into a full map-and-elevation rebuild on top of the earlier entity-architecture and combat-correctness work.**

This stretch's major work: procedural map generation (dungeon and alley-network generators) removed entirely in favor of a single hand-drawn map, extracted from a color-coded design image into a real blueprint; a full per-tile elevation model (pavement, low walls, full walls, fences/glass as a transparency-not-height exception) with genuine 3D-block tile rendering, elevation-aware entity positioning, and a local-player wall-occlusion fade so tall walls don't hide a character standing behind them; and a working multi-floor system — coordinate-matched staircase links between hand-drawn floors, orientation-inferred climb direction and progress, a visually-corrected (orientation-aware, no longer overshooting) climbing effect for entities crossing a staircase, and floor-switching wired into the local player's actual movement.

Known gaps, stated plainly rather than left implicit: AI units don't follow the player between floors or have any floor-awareness; the 0.5-elevation "extra movement to cross a low wall" rule exists as data but isn't wired into movement-range computation yet; fog of war resets on a floor switch rather than being remembered per floor; only one hand-drawn map exists, so `MissionSelectScene` has no real map picker at the moment.

See `docs/known-issues-and-suggestions.md` for the fuller current bug list and in-progress items.
