# Development Roadmap

---

## Phase 1 — Single-player core loop (current)

Most of the loop is in:

- Card + AP turn economy
- Simultaneous combat
- ZoC + Disengage
- Real AI archetypes
- Monsters as a separate entity type
- Character creation, inventory, win condition, match result

Still worth finishing before calling Phase 1 done:

- Shared deck reset between matches
- Hidden exit until relic found
- A couple of the remaining bugs
- Basic interactive help / tutorial

---

## Phase 2 — Local multiplayer & polish

- Hotseat 2–4 players
- Fuller trap set
- Better hand / combat feedback
- Map variety

---

## Phase 3 — Online (authoritative)

- Colyseus (or equivalent) authoritative rooms
- All combat / movement / relic logic server-side
- Simple lobby

---

## Phase 4+ — Accounts, progression, live service

Supabase auth + persistence, stat progression, matchmaking, seasons, cosmetics.

See the tech stack ADR for the locked platform decisions.
