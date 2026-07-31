# Relic Hunter Online

A browser-based tactical multiplayer game inspired by the 1999 classic _Battle Hunter_, evolved with Final Fantasy Tactics-style depth. Players compete as hunters on an isometric grid, drawing from a shared card deck to move, fight, defend, and set traps while racing to find and extract a target item before anyone else.

---

## Tech Stack

PixiJS v8 (rendering), Colyseus (planned networking), Supabase (planned auth/persistence), Vite + TypeScript, npm workspaces (`client/`, `shared/`).

## Project Structure

```
client/src/
├── core/           scenes, overlays, camera, game bootstrap, session state
├── debug/           debug-only test entities (guaranteed-death/surrender hunters), never imported outside dev paths
├── entities/          Card, Chest, Mercenary (visual tokens)
├── math/                iso projection, easing
├── scenes/                 MainMenu → CharacterCreation/Load → Lobby → MissionSelect → Map → MatchResult
├── systems/                  TurnManager (AP economy), MoveController (aim mode + pathing)
├── types/                      client-side cross-file types (e.g. EnemyEntity)
└── ui/
    ├── buttons/                 RadialActionWheel, BagButton
    ├── overlay/                   BattleOverlay, PauseOverlay, LoadingOverlay
    ├── CharacterPanel.ts           top-left hunter readout
    ├── DeckTracker.ts                shared-deck count
    ├── Hand.ts                        cascaded card row, drag-and-drop
    ├── InventoryPanel.ts               own / lootable / surrendering modes
    └── PlayZone.ts                      the "play a card" moment

shared/src/
├── ai/            mercenaryAI.ts (archetype decisions incl. loot/surrender choice), aiMemory.ts (cross-turn retreat memory)
├── game/           card, chest, combat, deck, generation, grid, item, movement, random, character
└── types/           mercenary.ts — MercenaryState/Stats
```

## Architecture Notes

**Scenes vs. Overlays.** `SceneManager` does full-replace navigation and blocks a scene's own `update()` during its `onEnter()`. `OverlayManager` layers UI on top of an active scene without touching it — `BattleOverlay` and the pre-match cinematic exist as Overlays specifically so the scene underneath survives intact.

**Combat is simultaneous, not sequential.** Both sides pick an action blind — Attack, Defend, Run, or Surrender — and the round resolves once, in full. Surrender takes unconditional precedence: verified directly in `combat.ts`, no damage computes from either side once either one surrenders. `attacker`/`defender` in `BattleOverlay` are display roles the caller assigns, not a hardcoded player-vs-AI assumption — built that way so the same system works once both sides can be real players.

**Items are a fixed 6-slot sparse array, not a growable one.** `MercenaryState.items` holds real `null` gaps — dropping an item leaves a hole at its own index rather than shifting everything else down, which is what lets Drop/Take/Give-up all coexist as genuinely different operations on the same underlying array.

**One shared card deck for the whole match.** Every hunter — player or AI — draws from `GameSession.sharedDeck`, making deck exhaustion (the planned boss trigger) a genuine match-wide event once it's built.

**`PlayZone` is a "logical overlay," not a real one.** It shows/hides directly around `Hand`'s own selection-mode lifecycle rather than routing through `OverlayManager`, since a true overlay would block the input a drag needs to keep tracking.

## Getting Started

```bash
npm install
npm run dev
```

## Controls (MapScene)

| Input                          | Action                                                   |
| ------------------------------ | -------------------------------------------------------- |
| WASD                           | Pan camera                                               |
| Mouse wheel                    | Zoom                                                     |
| Hover/tap near hand            | Reveal cards                                             |
| Drag a card onto PlayZone      | Confirm that card                                        |
| Click hub / ring nodes         | Move, Attack (opens sub-ring), Rest, Disengage, End Turn |
| Arrow keys + Enter             | Keyboard alternative to dragging, while selecting        |
| Click an enemy while targeting | Attack them                                              |
| Esc                            | Cancel current mode, or open Pause                       |
| R                              | Regenerate map (dev shortcut)                            |
