# Relic Hunter Online

**A browser-based tactical multiplayer game inspired by the 1999 classic _Battle Hunter_.**

Players compete as hunters on a grid-based battlefield, using dice rolls and cards to move, fight, set traps, and secure powerful relics. The core fantasy is tense, high-stakes tactical decision-making where positioning, timing, and resource management matter more than raw power.

---

## Vision & Core Pillars

Relic Hunter Online aims to capture the unique feel of the original game while evolving it into a modern, scalable live-service experience:

- **Dice + Card Action Economy** — Every meaningful action is resolved through dice rolls or played cards.
- **Grid-Based Tactics** — Positioning, movement range, and area control are central.
- **Relic Objective** — The primary win condition is locating, claiming, and extracting the target relic.
- **Competitive Player Interaction** — Hunters can battle each other, steal relics, and disrupt opponents.
- **Meaningful Progression** — Persistent hunter stats, cards, and cosmetics that carry across sessions.

Long-term goal: a commercial-grade platform with seasons, cosmetic monetization, skill-based matchmaking, and regular content updates.

---

## Tech Stack (Locked)

- **Client Rendering**: PixiJS v8.19.0 (WebGL-powered 2D)
- **Gameplay Networking**: Colyseus (authoritative game server)
- **Platform Services**: Supabase (auth, database, realtime, storage, edge functions)
- **Client Framework**: Vite + TypeScript
- **Monorepo**: `client/`, `server/`, `shared/`

Full architecture decisions and rationale are in `docs/01-tech-stack-decision.md`.

---

## Monorepo & npm Workspaces Setup

We use **npm workspaces** to manage the three packages in this repository (`client`, `server`, and `shared`).

### Why We Set This Up

Before workspaces, importing from `shared` required fragile relative paths like:

```ts
import { Card } from "../../../shared/src/types/card";
```

By using npm workspaces, we gain:

- Clean imports using `@relic-hunter/shared`
- Proper dependency management and deduplication
- Development symlinks so changes in `shared/` are instantly available to both `client` and `server`
- A clean foundation for sharing pure game logic between client and server (important for future offline/singleplayer support)

---

## Current Architecture (Client)

We are currently building the client-side foundation using a **Scene-based architecture**:

- `Game` — Owns the PixiJS `Application`, the render loop, and the `SceneManager`.
- `SceneManager` — Handles scene transitions safely (with race condition protection and proper lifecycle management).
- `Scene` — Interface that all screens (Lobby, Dungeon, etc.) implement.

This design keeps game logic decoupled from rendering and makes it easier to later move logic to the authoritative server in Phase 3.

---

## Project Structure

```
relic-hunter-online/
├── package.json                 # Root workspace file
├── client/
│   ├── src/
│   │   ├── core/
│   │   │   ├── Game.ts          # Main game controller + render loop
│   │   │   ├── SceneManager.ts  # Scene transition & lifecycle manager
│   │   │   └── Scene.ts         # Scene interface
│   │   ├── scenes/              # Individual scenes (LobbyScene, DungeonScene, etc.)
│   │   └── main.ts
│   └── package.json
├── server/
├── shared/
├── docs/
│   ├── 01-tech-stack-decision.md
│   └── 02-development-roadmap.md
├── README.md
└── .gitignore
```

---

## Getting Started (Development)

### Prerequisites

- Node.js ≥ 20

### Install

```bash
npm install
```

### Run Client

```bash
cd client
npm run dev
```

### Run Server (later)

```bash
cd server
npm run dev
```

---

## Development Roadmap

See `docs/02-development-roadmap.md`

We are currently in **Phase 1** — building the client-side scene system and core game loop foundation.

---

**Status**: Active development — Building client-side `Game` + `SceneManager` system.
