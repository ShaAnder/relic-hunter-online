# Current Progress

Phase 1 single-player core loop. Checked against the live repo.

---

## Working

**Combat**  
Simultaneous one-round fights. Surrender always takes priority. Red cards only boost attack. Defeat and surrender both move items correctly for player and AI.

**Zones of Control**  
Melee only, wall-aware. Crossing a zone triggers a reaction strike mid-move, then the path continues. One charge per distinct enemy zone per move. Disengage is a real 2 AP move that ignores ZoC and can be repeated.

**Attack ranges**  
- Melee — adjacent, projects ZoC  
- Ranged — strict cardinal line-of-sight  
- Caster — omnidirectional diamond, one obstruction allowed at reduced damage  

**AI hunters**  
Same `TurnManager` as the player. Real AP and hand cards. Three archetypes (Aggressive / Treasure / Balanced) with different movement goals, engagement thresholds, and combat bias. They pick the smallest Blue that actually reaches instead of always burning the biggest card.

**Monsters**  
Separate entity type. Fixed stats by tier, no hand, no items, always Attack. 15% spawn chance between individual mercenary turns, hard cap of 5. Always act after every hunter in the round.

**Other**  
Match log, hunter inspection panel, character creation (diminishing returns, mechanical class identity only), camera lock during AI/monster turns, SVG icons on the radial wheel, static Help scene.

---

## Designed but not built

- Hide the exit until the relic is found (strongest anti-kite lever we discussed)
- Monster frenzy once the relic is found
- Deck-exhaustion boss
- Interactive tutorial (Help is still a text page)
- Move UX rework (enter aim mode with base Move first, optional card after)

---

## Known pain points

- Shared deck does not reset between matches
- HP bar after knockout treats the reduced ceiling as 100%
- AI can Rest more than feels good (heal amount vs flee threshold)
- Discarding the win-condition relic is still allowed

See `docs/known-issues-and-suggestions.md` for the full list.
