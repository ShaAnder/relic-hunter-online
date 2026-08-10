# Known Issues & Suggestions

---

## Still open

- **Shared deck does not reset** after a finished match. You can start a new game with a depleted deck.
- **HP bar after knockout** uses the reduced ceiling as 100%, so a revived hunter looks full.
- **AI Rest spam** — heal amount vs the 0.5 flee threshold may just need tuning.
- **Discarding the win-condition relic** is still allowed. Needs a deliberate rule (block it or allow it).
- **Defeated hunter teleport** sometimes feels delayed (probably a camera/view issue rather than the teleport itself).

---

## Fixed

- Monsters could previously choose Defend/Run/Surrender — blocked.
- Defeated monsters no longer go through the hunter revival path.
- AI no longer takes a ZoC tick then immediately flees without attacking.
- Units could move through each other — blocked.
- Clicking UI panels while aiming could commit a move — fixed.
- Camera input could leak during AI/monster turns — locked at the source.
- Camera now tracks monster turns the same way it tracks AI hunters.

---

## Explicitly rejected

- Flat power penalty for carrying the relic (creates hot-potato play)
- Forced extraction delay at the exit (punishes legitimate evasion builds)
- Carrier "visibility" as a mechanic (camera already follows the active unit)

---

## Later ideas (not scheduled)

- Interactive tutorial instead of the static Help page
- Bind/lock combat card that forces a longer engagement
- Deck/hand-capacity rare item
- Sequential combat resolution (mutual kill becomes impossible) — needs its own dedicated pass if we ever want it
- Icon pass on cards, inventory, and header buttons (radial wheel is already done)
