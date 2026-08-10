# Turn & AP System

Every unit that can act (player, AI hunter) owns a real `TurnManager`.

---

## Base rules

- 3 AP per turn (Summoner will get 4 when built)
- Actions and costs:
  - Move — 1 AP
  - Attack — 2 AP
  - Rest — 1 AP
  - Disengage — 2 AP
- Order is free; spending an Action does not lock Move in the current build
- Disengage is a full alternative movement path that ignores Zones of Control

---

## Draw

- 1 card at turn start
- Rest: heal a percentage of current HP ceiling + draw up to 2 cards
- All draws come from the single shared match deck

---

## AI

AI hunters use the exact same class and the same AP gates. They do not act for free.
