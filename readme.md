# Relic Hunter Online

**A browser-based tactical multiplayer game inspired by the 1999 classic _Battle Hunter_, evolved with Final Fantasy Tactics-style depth.**

Players compete as hunters on an isometric grid, using an AP-driven turn system and cards to move, fight, defend, and set traps while racing to secure powerful relics. The core fantasy is tense, high-stakes tactical decision-making where positioning, timing, and resource management matter more than raw power.

---

## Vision & Core Pillars

- **Card Action Economy** — Every meaningful action is resolved through cards (blue Move, red Attack, yellow Defense, green Environment/Trap). No dice in the core loop.
- **AP System** — Base Action Points per turn (from the character's `ap` stat) across Move (1 AP, up to twice), Attack (2 AP), Rest (1 AP), and Disengage (1 AP). Spending Attack or Rest locks Move for the rest of the turn.
- **Grid-Based Tactics** — Isometric positioning, movement range, and future Zone of Control mechanics are central.
- **Relic Objective** — The primary win condition is locating, claiming, and extracting the target relic.
- **Competitive Player Interaction** — Hunters can battle each other, steal relics, and disrupt opponents.
- **Class-Based Progression** — Six launch classes (Tank, Brawler, Hunter, Scout, Mage, Summoner), each a small nudge toward a signature stat on top of a shared universal base, plus a 12-point creation budget.

Full mechanics: `docs/04-card-system-design.md`, `docs/05-turn-ap-system-design.md`, `docs/06-character-creation-design.md`.

---

## Tech Stack (Locked)

| Layer               | Technology                                                   |
| ------------------- | ------------------------------------------------------------ |
| Client Rendering    | PixiJS v8.19.0 (WebGL-powered 2D, isometric)                 |
| Gameplay Networking | Colyseus (authoritative game server)                         |
| Platform Services   | Supabase (auth, database, realtime, storage, edge functions) |
| Client Framework    | Vite + TypeScript                                            |
| Monorepo            | npm workspaces — `client/`, `server/`, `shared/`             |

Full architecture decisions and rationale: `docs/01-tech-stack-decision.md`

---

## Project Structure

```
relic-hunter-online/
├── package.json
├── client/
│   └── src/
│       ├── core/
│       │   ├── Camera.ts             # Pan, zoom, lock/follow
│       │   ├── Game.ts               # PixiJS bootstrap, owns SceneManager + OverlayManager
│       │   ├── GameSession.ts        # Cross-scene data bag (active character, mission params)
│       │   ├── CharacterRepo.ts      # Character persistence (localStorage now, interface-first)
│       │   ├── Overlay.ts            # Overlay interface — UI layered on top of a scene
│       │   ├── OverlayManager.ts     # Shows/hides overlays without touching the active scene
│       │   ├── Scene.ts              # Scene interface
│       │   └── SceneManager.ts       # Scene transitions + lifecycle (full replace, not a stack)
│       ├── entities/
│       │   ├── Card.ts               # Visual card (grayscale/highlight states, no position logic)
│       │   └── Mercenary.ts          # Visual token + continuous path animation
│       ├── math/
│       │   └── isoGridMath.ts        # Grid ↔ screen coordinate conversion
│       ├── rendering/
│       │   └── MapRenderer.ts        # ⚠️ Built but currently unused — see debt list
│       ├── scenes/
│       │   ├── MainMenuScene.ts      # New Character / Load Character / Settings (stub)
│       │   ├── CharacterCreationScene.ts  # 6 classes, stat allocation
│       │   ├── LoadGameScene.ts      # Select from saved characters
│       │   ├── LobbyScene.ts         # Persistent hub — Missions / Story / Shop / Collectibles / Quit
│       │   ├── MissionSelectScene.ts # Map size only, transitions to MapScene
│       │   ├── MapScene.ts           # Tactical map — movement, cards, turn coordination, pause
│       │   └── BattleScene.ts        # (next) Combat resolution between hunters
│       ├── systems/
│       │   ├── InputHandler.ts       # ⚠️ Built but currently unused — see debt list
│       │   ├── MoveController.ts     # Move mode state machine + path preview
│       │   └── TurnManager.ts        # AP pool, Move/Attack/Rest/Disengage costs
│       ├── ui/
│       │   ├── buttons/              # ButtonBar, ActionButton, EndTurnButton, MoveButton
│       │   ├── generics/Button.ts    # Self-contained button (owns its own onClick)
│       │   ├── overlay/PauseOverlay.ts  # Resume / Settings (stub) / Main Menu
│       │   ├── CharacterPanel.ts     # Character summary display
│       │   └── Hand.ts               # Fanned card hand, selection mode, caret nav
│       ├── css.d.ts
│       └── main.ts
├── server/                           # Colyseus server (Phase 3)
├── shared/
│   └── src/
│       ├── game/
│       │   ├── generation.ts         # Procedural map generation (seeded)
│       │   ├── grid.ts               # Grid data structure, tile types, findExitTile
│       │   ├── movement.ts           # BFS movement range + pathfinding
│       │   ├── random.ts             # Deterministic RNG
│       │   └── character.ts          # CharacterData, class modifiers, stat formula
│       └── types/
│           └── mercenary.ts          # MercenaryState + MercenaryStats (movement/attack/defense/maxHp/ap)
└── docs/
    ├── 01-tech-stack-decision.md
    ├── 02-development-roadmap.md
    ├── 03-current-progress.md
    ├── 04-card-system-design.md
    ├── 05-turn-ap-system-design.md
    ├── 06-character-creation-design.md
    ├── 07-knockout-loot-design.md
    ├── 08-summoner-design.md
    ├── 09-enemy-ai-design.md
    └── 10-scene-flow-design.md
```

---

## Scene Map

| Scene                    | Status      | Purpose                                                                   |
| ------------------------ | ----------- | ------------------------------------------------------------------------- |
| `MainMenuScene`          | Active      | New Character / Load Character / Settings (stub)                          |
| `CharacterCreationScene` | Active      | 6-class creation, 12-point stat allocation                                |
| `LoadGameScene`          | Active      | Select a saved character                                                  |
| `LobbyScene`             | Active      | Persistent hub between matches                                            |
| `MissionSelectScene`     | Active      | Map size selection → MapScene                                             |
| `MapScene`               | Active      | Tactical grid — move, explore, hunt relics, cards, pause                  |
| `LoadingScene`           | Planned     | Insertion point noted in `MissionSelectScene` — map gen + turn order roll |
| `BattleScene`            | **Next up** | Combat resolution when hunters engage                                     |
| `TownScene`              | Planned     | NPC interaction, shops, story                                             |
| `WorldMapScene`          | Planned     | Overworld travel between locations                                        |

---

## Architecture Overview

### Scene & Overlay System

`Game` bootstraps PixiJS and owns two siblings: `SceneManager` (full-replace scene transitions — `onEnter`/`onExit`/`update`/`onResize`) and `OverlayManager` (layers UI, like the pause menu, on top of the active scene without ever calling into it — the scene underneath stays fully intact, just paused). These are deliberately separate systems rather than one push/pop stack; `SceneManager`'s single-scene design is intentional, and pause/dialog-style UI is a narrower need that doesn't require rearchitecting it.

### MapScene and its Systems

| System           | Responsibility                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Camera`         | WASD pan, wheel zoom, lock/follow — covers moves, card selection, and the Exit card's teleport flights                    |
| `TurnManager`    | AP pool (sourced from the character's `ap` stat) and costs for Move / Attack / Rest / Disengage                           |
| `MoveController` | Move mode state machine: range, path preview, destination glow, commit                                                    |
| `Hand`           | Fanned card hand, selection mode gating, caret navigation, permanent skip slot                                            |
| `ButtonBar`      | Sidebar UI: Move, Action (dropdown), End Turn                                                                             |
| `PauseOverlay`   | Resume / Settings / Main Menu, shown via `OverlayManager`                                                                 |
| `Mercenary`      | Visual token; continuous ease-in/out animation, with an optional duration override for non-walked flights (the Exit card) |

**Known drift**: `MapRenderer` and `InputHandler` were extracted from `MapScene` in an earlier cycle but aren't currently wired in — `MapScene` (733 lines) has its own inline tile-drawing and input-handling logic again. Flagged for resolution alongside the upcoming `BattleScene` work rather than as a separate detour.

### Character System

`CharacterData` (persistent, `shared/src/game/character.ts`) and `MercenaryState` (ephemeral, live-match) are deliberately **not** related by inheritance — `spawnFromCharacter()` is the factory bridging them, since they'll eventually be owned by different backends (Supabase vs. Colyseus). Stats follow `Universal Base + Class Modifier + Player Points`, with Defense starting at 0 for every class (only Tank's modifier touches it) since combat resolves as subtractive damage — see `06-character-creation-design.md` for the full rebalancing story.

### Card System

Fully implemented to spec: Blue (1–3 + **E** exit-teleport), Red (1–6 + **A** double-damage + **C** critical), Yellow (1–4 + **A** nullify + **C** double-defense), Green (Stun, more trap types later). `Card.ts` owns only visual state (`setInteractive`/`setGreyedOut` are independent — resting cards are full-color-but-inert, only selection-mode filtering greys them out). `Hand.ts` owns the fanned layout and selection state machine. The Exit (**E**) card is fully playable: a two-flight teleport (to the exit tile, linger, then a random tile since no relic-carry state exists yet) with alpha-fade transitions and full camera follow.

Still stubbed: Defense/Trap cards beyond numeric values show feedback text only. Hand economy (draw/cap/spend) is a temporary full-refill-every-turn testing behavior — the real deck system is the explicitly-planned next major phase after core gameplay mechanics.

### Shared Package

`@relic-hunter/shared` contains pure logic with no PixiJS, no Colyseus, and no DOM references — safe to import on both client and server. `movement.ts` (BFS pathfinding) is already server-ready for Phase 3.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20

### Install

```bash
npm install
```

### Run Client (dev)

```bash
npm run dev
```

Opens at `http://localhost:5173`

### Controls (MapScene)

| Input                              | Action                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `WASD`                             | Pan camera                                                                        |
| Mouse wheel                        | Zoom                                                                              |
| `Move` button (sidebar)            | Open card selection                                                               |
| Arrow Left/Right                   | Navigate hand while selecting                                                     |
| Enter / Space                      | Confirm highlighted card                                                          |
| Click a card                       | Select + confirm immediately                                                      |
| `Action` button (sidebar)          | Open Attack / Rest / Disengage sub-menu                                           |
| `End Turn` button (sidebar) or `E` | End turn                                                                          |
| Mouse (in move mode)               | Preview path                                                                      |
| Click (in move mode)               | Commit move                                                                       |
| `Esc`                              | Close aim/selection, or open Pause if nothing's open — press again to close Pause |
| `R`                                | Regenerate map                                                                    |

---

## Current Status

**Phase 1 — Single-Player Core Loop** (active)

Working: full navigation (Landing→MainMenu→CharacterCreation/Load→Lobby→MissionSelect→Map), character creation with 6 classes and persistence, complete card system including the Exit card's teleport sequence, AP turn system, pause functionality.

**Starting now — core gameplay mechanics**: real combat resolution (Attack is currently a feedback-stub), one static enemy mercenary to fight, a `BattleScene` combat transition, and the item/relic pickup loop. The full card deck system (hand economy, remaining card effects) is the explicitly-planned next phase after these land.

See `docs/02-development-roadmap.md` for the full phase breakdown and `docs/03-current-progress.md` for the current sprint state.

---

## Commenting & Code Delivery Standards

All source files follow a consistent style (defined in the TabWorks system prompt §9–10):

- **File-level**: One JSDoc on the main class — role, architecture context, non-obvious design decisions.
- **Methods**: One-line JSDoc on every method; second line only for a real caller contract.
- **Blocks**: Short `//` label above logical groups.
- **Inline**: Only where a line is genuinely non-obvious.
- **Code delivery**: Every code block ships with a plain-language breakdown covering what each section does, why, how it connects, and any gotchas — referencing design docs by name and section where relevant.
