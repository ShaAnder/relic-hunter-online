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

## Tech Stack

- **Client Rendering**: PixiJS v8.19.0 (WebGL-powered 2D)
- **Gameplay Networking**: Colyseus (authoritative game server)
- **Platform Services**: Supabase (auth, database, realtime, storage, edge functions)
- **Client Framework**: Vite + TypeScript
- **Monorepo**: `client/`, `server/`, `shared/`

Full architecture decisions and rationale are in `docs/01-tech-stack-decision.md`.

---

## Project Structure

```
relic-hunter-online/
├── client/                 # PixiJS frontend (Vite)
│   ├── src/
│   │   ├── game/           # Core game logic & classes
│   │   ├── scenes/         # Game scenes (BattleScene, etc.)
│   │   └── assets/
│   ├── public/
│   └── package.json
├── server/                 # Colyseus authoritative game server
├── shared/                 # Shared types, schemas, utilities
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
- npm or pnpm

### 1. Clone & Install

```bash
git clone https://github.com/shaAnder/relic-hunter-online.git
cd relic-hunter-online

# Install all workspaces
npm install
```

### 2. Run the Client (Development)

```bash
cd client
npm run dev
```

Open `http://localhost:5173` — you should see the Vite starter (we’ll replace this with the actual game soon).

### 3. Run the Server (when we reach Phase 3)

```bash
cd server
npm run dev
```

---

## Development Roadmap

The full phased plan lives in:

**`docs/02-development-roadmap.md`**

We are currently completing **Phase 0 (Foundation)** and will move into **Phase 1 (Single-Player Core Loop)** immediately after.

Key rule we will follow: **All competitive mechanics become authoritative on the server from Phase 3 onward.** No client-trusted logic for movement, combat, or relic claims.

---

## Contributing / Development Notes

- We follow the roadmap strictly.
- All major architecture decisions are documented in `docs/`.
- Before starting new features, check which phase they belong to.
- Rapid iteration is encouraged, but technical debt that affects future monetization, scalability, or fairness will be called out and fixed early.

---

## License

TBD (will be decided before any public release).

---

**Status**: Active development — Phase 0 → Phase 1 transition in progress.
