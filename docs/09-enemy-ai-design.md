# Enemy AI & Monsters

Checked against `shared/src/ai/mercenaryAI.ts` and `monsterSpawning.ts`.

---

## Enemy hunters

Same shape as the player (`MercenaryState` + visual token). Only difference is `pilot: "ai"` and an archetype. They use the real TurnManager, real AP, and real hand cards.

### Archetypes

| Archetype | Default behaviour | Once the relic carrier is known |
|-----------|-------------------|---------------------------------|
| Aggressive | Path to nearest hunter, fight | Goes straight at the carrier |
| Treasure | Open chests, avoid fair fights | Shadows the carrier, only fights when strong |
| Balanced | Mix of pressure and objectives | Weighs risk before committing |

Movement cards: smallest Blue that closes the real gap.  
Engagement: scored by archetype (Aggressive is willing at low HP; Treasure needs a clear edge).  
In combat: bias Attack/Defend by personality, Run or Surrender when the numbers look bad.  
Loot priority: always take the match target if present, otherwise random filled slot.  
Surrender: never give up the target while any other item exists.

---

## Monsters

Not part of the archetype system.

- Always Attack, never play cards
- Default target: nearest hunter
- Once the carrier is known: switch to them, unless already adjacent to someone else

**Spawning**  
15% chance after every individual mercenary turn (player + each AI). Cap of 5 on the map.

**Turn order**  
Always after every hunter in the round, even if they spawned mid-round.

**Still missing**  
Deck-exhaustion boss. Frenzy movement bonus after the relic is found.
