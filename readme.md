# Relic Hunter Online

**A browser-based tactical multiplayer game inspired by the 1999 classic _Battle Hunter_, evolved with Final Fantasy Tactics-style depth.**

Players compete as hunters on an isometric grid, using an AP-driven turn system and cards to move, fight, defend, and set traps while racing to secure powerful relics. The core fantasy is tense, high-stakes tactical decision-making where positioning, timing, and resource management matter more than raw power.

---

## Vision & Core Pillars

- **Card Action Economy** — Every meaningful action is resolved through cards (blue Move, red Attack, yellow Defense, green Environment/Trap). No dice in the core loop.
- **AP System** — 3 base Action Points per turn across Move (1 AP, up to twice), Attack (2 AP), Rest (1 AP), and Disengage (1 AP). Spending Attack or Rest locks Move for the rest of the turn.
- **Grid-Based Tactics** — Isometric positioning, movement range, and future Zone of Control mechanics are central.
- **Relic Objective** — The primary win condition is locating, claiming, and extracting the target relic.
- **Competitive Player Interaction** — Hunters can battle each other, steal relics, and disrupt opponents.
- **Meaningful Progression** — Persistent hunter stats, cards, and cosmetics that carry across sessions.

Full card and turn mechanics: `docs/04-card-system-design.md`, `docs/05-turn-ap-system-design.md`

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
│       │   ├── Game.ts               # PixiJS bootstrap + render loop
│       │   ├── Scene.ts              # Scene interface
│       │   └── SceneManager.ts       # Scene transitions + lifecycle
│       ├── entities/
│       │   ├── Card.ts               # Visual card (grayscale/highlight states, no position logic)
│       │   └── Mercenary.ts          # Visual token + continuous path animation
│       ├── math/
│       │   └── isoGridMath.ts        # Grid ↔ screen coordinate conversion
│       ├── rendering/
│       │   └── MapRenderer.ts        # ⚠️ Built but currently unused — see debt list
│       ├── scenes/
│       │   ├── MapScene.ts           # Tactical map — movement, cards, turn coordination (601 lines, see debt list)
│       │   ├── BattleScene.ts        # (future) Combat resolution between hunters
│       │   └── LobbyScene.ts         # Title / lobby placeholder
│       ├── systems/
│       │   ├── InputHandler.ts       # ⚠️ Built but currently unused — see debt list
│       │   ├── MoveController.ts     # Move mode state machine + path preview
│       │   └── TurnManager.ts        # AP pool, Move/Attack/Rest/Disengage costs
│       ├── ui/
│       │   ├── ButtonBar.ts          # Sidebar: Move / Action (dropdown) / End Turn
│       │   ├── ActionButton.ts       # Action button + Attack/Rest/Disengage sub-menu
│       │   ├── EndTurnButton.ts      # Always-available end-turn control
│       │   ├── MoveButton.ts         # Move button (enabled/active states)
│       │   └── Hand.ts               # Fanned card hand, selection mode, caret nav
│       ├── css.d.ts
│       └── main.ts
├── server/                           # Colyseus server (Phase 3)
├── shared/
│   └── src/
│       ├── game/
│       │   ├── generation.ts         # Procedural map generation (seeded)
│       │   ├── grid.ts               # Grid data structure + tile types
│       │   ├── movement.ts           # BFS movement range + pathfinding
│       │   └── random.ts             # Deterministic RNG
│       └── types/
│           └── mercenary.ts          # MercenaryState + MercenaryStats (incl. AP)
└── docs/
    ├── 01-tech-stack-decision.md
    ├── 02-development-roadmap.md
    ├── 03-current-progress.md
    ├── 04-card-system-design.md
    └── 05-turn-ap-system-design.md
```

---

## Scene Map

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

`Game` bootstraps PixiJS and owns a single `SceneManager`. Scenes implement the `Scene` interface — `onEnter`, `onExit`, `update`, `onResize`.

### MapScene and its Systems

| System           | Responsibility                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Camera`         | WASD pan, wheel zoom, lock/follow — locks the instant Move is pressed (card selection starts), not just once aiming begins |
| `TurnManager`    | AP pool and costs for Move / Attack / Rest / Disengage; movement budget sourced from the mercenary's speed stat            |
| `MoveController` | Move mode state machine: range, path preview, destination glow, commit                                                     |
| `Hand`           | Fanned card hand, selection mode gating (filter-driven grayscale + interactivity), caret navigation, permanent skip slot   |
| `ButtonBar`      | Sidebar UI: Move, Action (dropdown), End Turn                                                                              |
| `Mercenary`      | Visual token; continuous ease-in/out animation across the whole committed path                                             |

**Known drift**: `MapRenderer` and `InputHandler` were extracted from `MapScene` in an earlier cycle but aren't currently wired in — `MapScene` has its own inline tile-drawing and input-handling logic again, duplicating what those classes already do. Flagged in the tech debt list rather than silently fixed, since resolving it should probably happen alongside the upcoming combat/enemy work rather than as an isolated detour.

### Card System

`Card.ts` is a pure rendering component — two independent visual controls (`setInteractive`, `setGreyedOut`) rather than one conflated flag, so resting cards can be full-color-but-inert and selection-mode cards can be gray-and-inert without one state fighting the other. `Hand.ts` owns all positioning (fanned arc layout, pivot-based rotation, angle-following hover pull) and the selection state machine — pressing Move opens selection, confirming a card (click or Enter/Space with the caret) fires the effect callback, shows a brief detail overlay, and removes the card (except the permanent "No Card" slot). Blue Move cards are restricted to the turn's first Move press, enforced at both the `TurnManager` data layer and the `Hand` filter.

Still stubbed: Defense (yellow) and Trap (green) cards show feedback text only — no real effect yet. Hand economy (draw/cap/spend) is replaced by a temporary full-refill-every-turn testing behavior.

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

| Input                              | Action                                  |
| ---------------------------------- | --------------------------------------- |
| `WASD`                             | Pan camera                              |
| Mouse wheel                        | Zoom                                    |
| `Move` button (sidebar)            | Open card selection                     |
| Arrow Left/Right                   | Navigate hand while selecting           |
| Enter / Space                      | Confirm highlighted card                |
| Click a card                       | Select + confirm immediately            |
| `Action` button (sidebar)          | Open Attack / Rest / Disengage sub-menu |
| `End Turn` button (sidebar) or `E` | End turn                                |
| Mouse (in move mode)               | Preview path                            |
| Click (in move mode)               | Commit move                             |
| `Esc`                              | Cancel move/selection                   |
| `R`                                | Regenerate map                          |

---

## Current Status

**Phase 1 — Single-Player Core Loop** (active)

Working: isometric map generation, camera, mercenary movement with continuous animation, full AP turn system (Move/Attack/Rest/Disengage), fanned card hand with working selection flow, sidebar UI, action feedback text.

**Starting now**: core gameplay loop completion + enemy entities — real combat resolution, an AI-controlled opponent, win/loss conditions.

See `docs/02-development-roadmap.md` for the full phase breakdown and `docs/03-current-progress.md` for the current sprint state.

---

## Commenting & Code Delivery Standards

All source files follow a consistent style (defined in the TabWorks system prompt §9–10):

- **File-level**: One JSDoc on the main class — role, architecture context, non-obvious design decisions.
- **Methods**: One-line JSDoc on every method; second line only for a real caller contract.
- **Blocks**: Short `//` label above logical groups.
- **Inline**: Only where a line is genuinely non-obvious.
- **Code delivery**: Every code block ships with a plain-language breakdown covering what each section does, why, how it connects, and any gotchas — referencing design docs by name and section where relevant.

No lecture paragraphs in code. Teaching commentary lives in chat, ADRs, and docs.
