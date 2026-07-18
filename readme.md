# Relic Hunter Online

**A browser-based tactical multiplayer game inspired by the 1999 classic _Battle Hunter_, evolved with Final Fantasy Tactics-style depth.**

Players compete as hunters on an isometric grid, using dice rolls and cards to move, fight, set traps, and secure powerful relics. The core fantasy is tense, high-stakes tactical decision-making where positioning, timing, and resource management matter more than raw power.

---

## Vision & Core Pillars

Relic Hunter Online aims to capture the unique feel of the original game while evolving it into a modern, scalable live-service experience:

- **Dice + Card Action Economy** — Every meaningful action is resolved through dice rolls or played cards.
- **Grid-Based Tactics** — Isometric positioning, movement range, and area control are central.
- **Relic Objective** — The primary win condition is locating, claiming, and extracting the target relic.
- **Competitive Player Interaction** — Hunters can battle each other, steal relics, and disrupt opponents.
- **Meaningful Progression** — Persistent hunter stats, cards, and cosmetics that carry across sessions.

Long-term goal: a commercial-grade platform with seasons, cosmetic monetization, skill-based matchmaking, and regular content updates — designed from day one to support multiple scene and map types (dungeons, arenas, towns, overworld) in the FFT tradition.

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
├── package.json                      # Root workspace config
├── client/
│   └── src/
│       ├── core/
│       │   ├── Camera.ts             # Pan, zoom, lock/follow
│       │   ├── Game.ts               # PixiJS bootstrap + render loop
│       │   ├── Scene.ts              # Scene interface
│       │   └── SceneManager.ts       # Scene transitions + lifecycle
│       ├── entities/
│       │   └── Mercenary.ts          # Visual token + continuous path animation
│       ├── math/
│       │   └── isoGridMath.ts        # Grid ↔ screen coordinate conversion
│       ├── rendering/
│       │   └── MapRenderer.ts        # Tile graphics + camera centering
│       ├── scenes/
│       │   ├── MapScene.ts           # Tactical map — movement, exploration, relic hunting
│       │   ├── BattleScene.ts        # (future) Combat resolution between hunters
│       │   └── LobbyScene.ts         # Title / lobby placeholder
│       ├── systems/
│       │   ├── InputHandler.ts       # Keyboard + mouse wiring for MapScene
│       │   ├── MoveController.ts     # Move mode state machine + path preview
│       │   └── TurnManager.ts        # Turn gate, movement budget, end-turn logic
│       ├── ui/
│       │   └── MoveButton.ts         # Move button (enabled / active / disabled states)
│       ├── css.d.ts                  # CSS import type declaration
│       └── main.ts                   # Entry point
├── server/                           # Colyseus server (Phase 3)
├── shared/
│   └── src/
│       ├── game/
│       │   ├── generation.ts         # Procedural map generation (seeded)
│       │   ├── grid.ts               # Grid data structure + tile types
│       │   ├── movement.ts           # BFS movement range + pathfinding
│       │   └── random.ts             # Deterministic RNG
│       └── types/
│           └── mercenary.ts          # MercenaryState (shared client/server)
└── docs/
    ├── 01-tech-stack-decision.md
    ├── 02-development-roadmap.md
    └── 03-current-progress.md
```

---

## Scene Map

Scenes are named by what the **player is doing**, not the map type:

| Scene           | Status  | Purpose                                    |
| --------------- | ------- | ------------------------------------------ |
| `LobbyScene`    | Active  | Title screen / matchmaking                 |
| `MapScene`      | Active  | Tactical grid — move, explore, hunt relics |
| `BattleScene`   | Planned | Combat resolution when hunters engage      |
| `TownScene`     | Planned | NPC interaction, shops, story              |
| `WorldMapScene` | Planned | Overworld travel between locations         |

---

## Architecture Overview

### Scene System

`Game` bootstraps PixiJS and owns a single `SceneManager`. Scenes implement the `Scene` interface — `onEnter`, `onExit`, `update`, `onResize` — and are swapped in/out without leaking listeners or containers.

### MapScene and its Systems

`MapScene` is a thin coordinator. The real work is split across dedicated systems:

| System           | Responsibility                                                                   |
| ---------------- | -------------------------------------------------------------------------------- |
| `Camera`         | WASD pan, wheel zoom, lock/follow during move animation                          |
| `MapRenderer`    | Builds iso tile graphics from a `Grid`; returns timing stats                     |
| `TurnManager`    | One Move per turn; grows into full dice/card phases later                        |
| `MoveController` | Move mode state machine: range, path preview, destination glow, commit           |
| `InputHandler`   | Attaches/detaches all keyboard + mouse listeners; translates events to callbacks |
| `Mercenary`      | Visual token; continuous ease-in/out animation across the whole committed path   |

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

Or from the client directory:

```bash
cd client && npm run dev
```

Opens at `http://localhost:5173`

### Controls (MapScene)

| Input                | Action           |
| -------------------- | ---------------- |
| `WASD`               | Pan camera       |
| Mouse wheel          | Zoom             |
| `Move` button        | Enter move mode  |
| Mouse (in move mode) | Preview path     |
| Click (in move mode) | Commit move      |
| `Esc`                | Cancel move mode |
| `E`                  | End turn         |
| `R`                  | Regenerate map   |

---

## Current Status

**Phase 1 — Single-Player Core Loop** (active)

Working: isometric map generation, camera, mercenary movement with continuous animation, move mode with path preview + destination glow, one-Move-per-turn system.

Next: dice rolling system → card hand → movement budget from dice → combat.

See `docs/02-development-roadmap.md` for the full phase breakdown and `docs/03-current-progress.md` for the current sprint state.

---

## Commenting Standard

All source files follow a consistent style (defined in the TabWorks system prompt §9):

- **File-level**: One JSDoc on the main class — role, architecture context, non-obvious design decisions.
- **Methods**: One-line JSDoc on every method; second line only for a real caller contract.
- **Blocks**: Short `//` label above logical groups.
- **Inline**: Only where a line is genuinely non-obvious.

No lecture paragraphs in code. Teaching commentary lives in chat, ADRs, and docs.
