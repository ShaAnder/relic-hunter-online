# Combat Rework — Design

Status: designed, not yet built. Target: this weekend's major pass, alongside the first boss monster. Supersedes the combat-resolution parts of `05-turn-ap-system-design.md` and the class-scoping parts of `13-zones-of-control-design.md` once actually built — those documents still describe current, live behavior until this lands.

## The problem this solves

Zones of control only ever punish melee-adjacent presence. A ranged attacker dealing full damage from outside that range is structurally immune to the game's own core risk mechanic — not a tuning gap, a property of the geometry itself. No amount of AI improvement or stat balancing closes this, because a perfectly-played ranged unit against a perfect opponent still never takes a ZoC hit while landing full damage every time.

This gets meaningfully worse under the planned move to sequential, multi-round combat resolution (see below). In a single simultaneous exchange, the free-hit problem happens once per fight. Across three sequential rounds, it happens up to three times per fight, compounding — melee spends rounds closing distance while ranged spends every round landing a clean, unanswered hit. Sequential resolution doesn't just fail to fix the asymmetry, it multiplies it.

Also raised independently: allowing ranged classes to deal full primary damage creates real map-design tension — melee-leaning players would only want tight, close-quarters maps; ranged-leaning players would only want open sniping lines. Removing ranged as a primary damage source removes this pressure for free, since there's no longer a reason to specifically seek out open maps for damage output.

## Core resolution model

Combat moves from one simultaneous exchange to three sequential rounds. Each side takes a turn; after three rounds resolve, the battle ends. Full consequence audit of this shift, beyond the ranged interaction above, still needs its own pass once building starts — this doc captures the decision, not yet every downstream effect.

## Ranged is no longer a primary damage source

Ranged attacks become setup/debuff tools rather than direct damage. A ranged-flavored ability applies a status effect (armor-crack, weakness, poison, etc.) rather than dealing meaningful damage on its own. Core combat damage happens at melee range, full stop — this is a deliberate, explicit design constraint for the rework, not an incidental side effect.

**Chosen shape (Option A, confirmed viable)**: a debuff-strike is a genuinely separate action category (see "Special," below), not a flavor of Attack. Because it doesn't trigger Attack's Move-lock, a full turn can look like: Move → debuff-strike → Attack, all in one turn, with the follow-up attack benefiting from whatever the debuff applied (a damage bonus, an armor reduction, etc.). This was checked directly against the existing AP-economy rule that spending Attack permanently locks Move for the rest of that turn — since debuff-strike isn't Attack, it never touches that lock at all, and the sequence is mechanically sound as designed.

Debuff duration/follow-up window and exact numbers (e.g., a discussed 1.5x follow-up bonus, a discussed 2-turn debuff lifespan) are still open — explicitly flagged during design as "we'll figure this out as we go," not locked yet.

**Explicit principle, worth keeping visible going forward**: class identity should not be tied to core combat stats or the core resolution mechanic itself — doing so was identified as actively working against class identity ("it kills it, in a way"). Concretely: don't reintroduce "ranged range-by-class" as the thing that differentiates classes. Differentiate through specific named abilities instead (a Hunter's poison arrow, a Trapper's own ranged-attack ability, a Scout's traversal perk, a Hunter's trap detection) — flavor and mechanism per class, not a shared numeric axis.

## Zones of control — narrower scope, not removed

ZoC is kept as a mechanic, but narrows from "every melee class" to Brawler specifically — Brawler is the class that takes a swing at anyone lingering nearby, framed as its core identity rather than a shared melee trait.

**Real implication, flagged directly during design and confirmed intentional**: this removes Tank from `MELEE_CLASSES`'/zone-projection entirely, not just narrows it. Tank is meant to get its own separate defensive-flavored special later (floated name: "Fortress Stance" or similar — spend all AP to enter a defensive stance, can't move, takes no damage that turn). Not yet built; noted here so Tank doesn't end up without a real identity piece once Brawler-only ZoC actually lands.

## The Special action category

A third AP-costed action, alongside the existing Attack and Rest, specifically for class-specific abilities (debuff-strikes, Tank's future stance ability, and whatever else classes end up needing).

- **Baseline cost**: 1 AP.
- **Scaling**: stronger/more powerful specials cost more AP, following the same diminishing-returns instinct already used elsewhere in this game's stat-cost design (character creation's movement/attack/defense/HP costs).
- **Move-lock**: deliberately does NOT trigger the same lock Attack and Rest do. This is the mechanical piece that makes the debuff-strike-then-attack sequence above actually work — if Special locked Move the same way, Option A would be impossible and only the (also-viable, more conservative) Option B — apply the debuff, land the bonus on this turn or the next — would work instead.
- **Open question, not yet decided**: whether every class's specials uniformly skip the Move-lock, or whether some heavier/more committing specials are meant to lock Move too as a real cost. Worth deciding once there are more than one or two specials actually built, rather than locking a blanket rule in now.

## Anti-turtling — cooldowns

Specials will carry per-unit cooldowns once built, specifically to prevent spamming the same ability repeatedly or turtling a fight out via one dominant action. Not yet designed in detail — number of turns, per-ability vs shared cooldown pools, etc. all still open.

## Explicitly not decided yet

- Exact debuff numbers (bonus multiplier, duration).
- Whether Option A or Option B ends up feeling better in actual play — both are mechanically sound now that Special is confirmed separate from Attack; final call is a playtesting question, not a design-on-paper one.
- Full downstream consequences of 3-round sequential resolution beyond the ranged interaction (surrender timing across rounds, mutual-defeat handling, etc.).
- Cooldown specifics.
- Whether Special's Move-lock behavior is uniform across all classes or ability-specific.
