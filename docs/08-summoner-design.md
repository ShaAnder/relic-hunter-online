# Summoner Class

Status: design mostly locked, not built. Sequenced after the core loop and AI work.

---

## Baseline

- +1 AP (base 4 instead of 3)
- No Attack / Defense / HP bonus — weakest personal combat profile on purpose

## Summon action

- Costs 2 AP
- Does **not** lock Move (unlike Attack / Rest / Disengage)

Legal combinations at 4 AP include Move + Summon and Summon + Summon.  
Attack + Summon is still an open question.

---

## Pet archetypes

| Type | Lifespan | Role |
|------|----------|------|
| Aggressive | Expires after N turns | Autonomous damage |
| Defensive/Utility | Until killed | Tank and/or aura (exact behaviour open) |
| Exploration | Until killed | Finds loot/relic, must bring it back to the Summoner |

Exploration pet is the interesting one: it can locate the relic but cannot extract. It has to return the item to the Summoner. While carrying, it becomes a high-value target.

Pets reuse the same AI controller framework as enemy hunters (friendly vs hostile flag). Knockout/loot rules are the same as player characters.

---

## Still open

1. Is Attack + Summon intentionally blocked?
2. Exact behaviour of the defensive/utility pet
3. How the relic hand-off works (adjacency? free? costs AP?)
4. Simultaneous summon cap
5. What happens to pets when the Summoner is knocked out
