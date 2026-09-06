# Enhanced AI Decision-Making — Design Reference

**Status:** planning document, not implementation-ready. Nothing here should be
built until it's explicitly picked up — this is a map for later, not a queue.

**Why this exists:** the current AI is a functional stand-in for multiplayer,
not a genuine opponent. This doc captures what exists today, what the original
*Battle Hunter* game's documented AI behavior teaches us (this game's direct
ancestor — same card colors, same core loop), and a structured way to grow
from "stand-in" to "genuinely clever" in stages, without a rewrite.

---

## 1. Current state — what actually exists today

Worth being precise about this before proposing anything, since "make the AI
smarter" means different things depending on the real starting point.

### Archetypes (the only "personality" axis that exists)

```ts
type AiArchetype = "aggressive" | "treasure" | "balanced";
```

Three values, set once per AI hunter at spawn, never changed during a match.
They currently affect exactly three things:

- **Movement target** (`decideMovementTarget`) — `aggressive` beelines for the
  nearest living rival; `treasure` prioritizes unopened chests over chasing
  whoever holds the target item; `balanced` is the fallback in between.
- **Combat flee threshold** (`chooseCombatAction`) — `aggressive` won't
  consider fleeing until 12% HP, `treasure` bails at 40%, everyone else at 25%.
- **Attack/defend base scoring weights** — `aggressive` leans further toward
  attacking, `treasure` leans further toward defending.

That's the entire extent of personality differentiation right now. Every
other decision (card usage, rest timing, trap usage) is either archetype-blind
or doesn't exist yet.

### Card usage (as of this session's fixes)

- **Movement (blue) cards** — as of the most recent fix, AI always spends its
  strongest blue card when moving, never conserves it for "genuinely needed"
  moves only. Matches the guide's "never conserve" principle for this one
  card type.
- **Combat (red/yellow) cards** — `bestCardFor()` always grabs the strongest
  available card of the relevant color whenever attack/defend/run is chosen.
  Already "never conserves" — no gate exists here.
- **Trap (green, `actionType: "stun"`) cards** — as of this session, AI
  places a trap at its own tile at the start of every turn if it's holding
  one. This is the simplest possible version: no strategic placement, no
  timing judgment, just "have it, use it."
- **Rest** — a single, non-archetype-varied threshold (`hpRatio < 0.25`) for
  whether an AI rests when it can't otherwise act. Not tied to archetype at
  all, unlike the combat flee threshold.

### Abilities / class specials

```ts
CLASS_SPECIALS = {
  brawler: { id: "overwatch", apCost: 1, isStance: true },
  tank: null,
  hunter: null,
  // ...
}
```

**AI never calls `getClassSpecial()` or considers using an ability at all.**
Only `brawler` even has a built special right now; everything else is `null`
(not implemented). This is a completely open gap, not a partially-built one.

### What doesn't exist as a concept yet

- No "confidence" or risk-assessment model — nothing like the guide's
  described red-vs-yellow-card judgment based on the opponent's own card use.
- No memory of *specific* rivals across turns beyond the single `memory.extracting`
  flag (whether this AI is currently carrying the target item).
- No "Panic"-equivalent unpredictability system.
- No distinction between "clever" (switch to pursuit the instant the target
  is found, even before finding it themselves) and the current archetypes.

---

## 2. What the source game's AI actually did — reusable principles

Pulled from a documented AI guide for the original *Battle Hunter* (PS1),
this game's direct ancestor. Not everything transfers 1:1 (different classes,
different map shape), but the *underlying decision patterns* are exactly the
kind of thing worth mining, since this game is deliberately built on the same
skeleton.

### The four priority archetypes (we have three)

| Original | Behavior | Closest current equivalent |
|---|---|---|
| **Balanced** | Collect items until none left, then pursue the target carrier | `balanced` — roughly matches |
| **Aggressive** | Ignore items, wander and pick fights, snap to pursuit once target is *found* | `aggressive` — close, but ours beelines for *any* rival immediately rather than wandering until the target surfaces |
| **Passive** | Collect items, then flags; never pursues the target carrier unless nothing else is reachable | **doesn't exist** — closest is `treasure`, but `treasure` still eventually chases the carrier |
| **Clever** | Seeks the target item *itself*; the instant anyone (including itself) finds it, switches to single-minded pursuit | **doesn't exist at all** — this is the "smart" archetype the guide singles out as the most dangerous common type |

**Concrete gap**: we're missing both a genuinely *passive* archetype (never
chases, ever) and the *clever* archetype (actively hunts for the target,
switches instantly on discovery). Clever is specifically called out in the
source material as "quite possibly the most competent rival hunters" — worth
prioritizing if the goal is a genuinely sharper opponent.

### "Detection range" — a concept we don't have

> AI hunters can only "detect" the presence of potential objectives within a
> certain range around them... if their preferred targets are too far away or
> blocked off, they behave as if those objectives do not exist.

Our current `decideMovementTarget` has no distance cutoff — an AI will always
path toward the *global* best target (nearest chest, target carrier, etc.)
regardless of how far away it is. This is actually a meaningful behavioral
difference: the source game's AI feels more "local" and reactive, ours is
more "omniscient." Worth deciding deliberately whether omniscient targeting
is fine for this game's smaller maps, or whether a detection radius would
make AI feel more human.

### Rest threshold, per-archetype

> The possible thresholds are at multiples of 25%... [varies by type, e.g.]
> Turtle: 25%, Guardian: 75%, Bully: "100% (usually)"

Our rest threshold is a single flat value (25%) for every archetype. The
combat flee threshold is *already* archetype-varied (12/25/40%) — rest never
got the same treatment. This is a small, easy inconsistency to fix whenever
rest logic is next touched: reuse the same three (or more) tiers combat
already has.

### Card confidence in combat — a genuinely new mechanic

> If their opponent decides to use a +9 red card to Counterattack, the AI
> attacker becomes more likely to use a yellow card for self-preservation.

Our `chooseCombatAction` reacts to the *opponent's stats*, but not to what
card the opponent actually played this exchange. The source AI's card choice
is responsive within a single exchange — if you go big, it gets more
cautious. This is a genuinely more advanced behavior than anything currently
modeled and would be a meaningfully "smarter"-feeling addition.

### Panic / unpredictability — optional, flavor-heavy

> Panic assigns the hunter a *random* one of the other AI routines for that
> turn... makes it almost impossible to predict what a hunter will do.

Lower priority than the above — this is closer to a chaos/flavor feature than
a core intelligence upgrade. Worth having on the list, not worth building
early.

### Item-based item pickup behavior

> AI hunters behave as if every item they find is pre-identified... will
> immediately enjoy the bonus.

Not really applicable — our items don't have an "unidentified" state the way
the source game's did. No action needed here, just noting it's a mechanic
that doesn't map onto our systems.

---

## 3. Proposed decision-tree structure for later

This is the shape a genuinely smarter AI turn *could* take — not a
prescription for exactly how to code it, but the layers worth separating so
each can be built and tuned independently.

```
AI Turn
│
├─ 1. Status check
│   ├─ Stunned / incapacitated? → skip turn entirely (already handled)
│   └─ Panicked? (future) → override everything below with a random routine
│
├─ 2. Resource check (before any movement decision)
│   ├─ Holding a green/trap card? → use it (done)
│   ├─ Holding a usable class special? → evaluate (NEW — see §3a)
│   └─ HP below archetype's rest threshold AND can't act meaningfully? → rest
│
├─ 3. Objective priority (archetype-driven)
│   ├─ Balanced → items, then carrier
│   ├─ Aggressive → nearest rival, snap to carrier once target is *found*
│   ├─ Passive (NEW) → items then flags/exit, never chases carrier unless forced
│   └─ Clever (NEW) → actively seeks target item; instant pursuit on discovery
│
├─ 4. Movement card decision
│   └─ Always use strongest available blue card (done)
│
├─ 5. Combat decision (if adjacent to a rival/monster)
│   ├─ Attack/Defend/Run scoring (exists, archetype-weighted)
│   ├─ Card confidence within the exchange (NEW — see §2 above)
│   └─ Ability/special usage (NEW — see §3a)
│
└─ 6. End-of-turn cleanup (exists)
```

### 3a. Ability/special usage — needs its own sub-tree once classes exist

Since only `brawler`'s `Overwatch` (a stance) is built, this can't be fully
designed yet — but the shape of the decision is worth sketching now so it's
not bolted on awkwardly later:

- **Stance specials** (like Overwatch): binary "activate now or not" —
  probably archetype-weighted (aggressive activates offensively-useful
  stances eagerly, passive/treasure activates defensively-useful ones).
- **Active/consumable specials** (once built): will need their own cost-benefit
  scoring, likely similar in shape to `chooseCombatAction`'s existing
  score-and-pick-highest pattern — reuse that structure rather than invent
  a new one.

**This section should be revisited once at least 2-3 classes have real
specials built**, so the design isn't guessing at a shape that doesn't fit
the actual abilities.

---

## 4. Suggested phased approach (when this gets picked up)

Not a commitment to build in this order — a suggestion for how to slice it
so each phase is independently shippable and testable, matching the
"small, not sweeping" approach already established this session.

**Phase 1 — cheap, high-signal fixes**
- Rest threshold becomes archetype-tiered, matching the existing combat flee
  threshold pattern exactly (12/25/40, or similar).
- Nothing else changes; smallest possible change with an immediate,
  observable behavior difference.

**Phase 2 — the two missing archetypes**
- Add `passive` (never chases carrier unless nothing else reachable).
- Add `clever` (actively seeks target, instant-switches on discovery) —
  the guide's own "most competent" type, so this is the highest-value single
  addition on this whole list.

**Phase 3 — in-combat card confidence**
- `chooseCombatAction` starts reacting to the *specific card* the opponent
  played this exchange, not just their stats — the "they went big, I get
  cautious" behavior.

**Phase 4 — detection range (optional, needs a design decision first)**
- Only worth doing if omniscient targeting is judged to feel wrong for this
  game's maps. Needs an explicit "yes, let's do this" before starting, since
  it changes how every archetype's targeting reads, not just one.

**Phase 5 — ability/special usage**
- Blocked on more classes having real specials built. Revisit §3a at that
  point.

**Phase 6 — Panic/unpredictability (flavor, lowest priority)**
- Genuinely optional; adds chaos/character more than raw intelligence.

---

## 5. Open questions worth answering before Phase 2+

- Should `passive` and `clever` be *new* archetype values, or should
  `treasure` be renamed/adjusted to actually match "passive" as the guide
  describes it (never chasing at all), with a genuinely new `treasure`-like
  behavior introduced separately if still wanted?
- Detection range: is "AI can see the whole map" actually a problem worth
  fixing, or does it just make AI feel appropriately competent on maps this
  size? Worth watching a few matches with an eye specifically on this before
  deciding.
- Card confidence (Phase 3) requires `chooseCombatAction` to know what card
  the *opponent* chose before it finalizes its own choice — on a human
  opponent, that information doesn't exist yet at decision time. Needs a
  design decision on whether AI-vs-AI gets this behavior while AI-vs-human
  can't (since a human's card choice isn't visible to the AI ahead of time
  the way another AI's simulated choice might be), or whether it only ever
  applies to the *reactive* side of an exchange (defending against an
  already-played card), which works for both cases symmetrically.
