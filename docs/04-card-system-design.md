# Card System

One shared deck for the whole match. Every hunter (player and AI) draws from it.

---

## Colours

| Colour | Role | Typical values |
|--------|------|----------------|
| Blue   | Movement | 1–3, plus special **E** (Exit) |
| Red    | Attack   | 1–9, plus **A** (×2) and **C** (×1.5) |
| Yellow | Defense  | 1–6, plus **A** (Nullify) and **C** (×2) |
| Green  | Environment / traps | Present in the deck, placement still limited |

Specials:

- **A** — doubles the relevant stat (or full Nullify on Yellow)
- **C** — 1.5× (Red) or 2× (Yellow)
- **E** (Blue only) — guaranteed escape in combat, or teleport to Exit on the map (does **not** trigger the win)

---

## Economy

- Draw 1 at the start of every turn
- Rest draws up to 2 more
- One card per action maximum
- Shared deck is built once per match via `buildSharedDeck()`

Known issue: the shared deck is not cleared between matches.
