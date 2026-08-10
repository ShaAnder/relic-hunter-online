# Knockout, Defeat & Surrender

---

## Defeat (HP → 0)

- Teleport away
- HP ceiling becomes half of max HP until the match ends (Rest cannot heal past it)
- If defeated by another hunter: one item is stolen
- Monsters do not steal items

---

## Surrender

- Unconditional — resolves no matter what the other side chose
- Keep current HP (no ceiling change)
- Give up one item of your own choice, or nothing if inventory is empty
- Item picker UI is still a stub (currently takes first filled slot)

---

## AI rules

- Loot priority: match target first, otherwise random filled slot
- Surrender: never give up the target while any other item exists
