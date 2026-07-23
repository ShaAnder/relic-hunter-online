import type { CardData } from "./card";
import type { MercenaryStats } from "../types/mercenary";

/**
 * Combat is resolved as ONE simultaneous, single round — not sequential
 * attacker/defender turns. Both combatants independently pick an action
 * (blind — neither sees the other's choice first), each may play one
 * card matching that action's allowed color, and the round resolves once
 * in full before returning to the overworld map. There is no multi-round
 * BattleScene state machine and no fixed "attacker"/"defender" role —
 * whichever action YOU pick determines your own offense/defense for
 * that single exchange, independent of what the other side picked.
 */
export type CombatAction = "attack" | "defend" | "run" | "surrender";

/**
 * One side's committed choice for the round. `
 */
export interface CombatChoice {
	action: CombatAction;
	stats: MercenaryStats;
	card?: CardData;
}

export interface CombatSideOutcome {
	damageTaken: number;
	/** True if a Yellow "A" (Nullify) fully blocked incoming damage this round. */
	nullified: boolean;
	/** Only meaningful if this side chose "run". */
	escaped?: boolean;
	/** Only meaningful if this side chose "surrender" — whether an item changes hands. */
	itemGiven?: boolean;
}

export interface CombatRoundResult {
	a: CombatSideOutcome;
	b: CombatSideOutcome;
}

/**
 * Resolve one full combat round between two simultaneous, independent
 * choices. This is the single entry point BattleScene calls — it
 * dispatches to the right internal handling based on what's actually in
 * play (a surrender short-circuits everything; a run needs the speed
 * contest; otherwise it's a normal attack/defend exchange).
 */
export function resolveCombatRound(
	a: CombatChoice,
	b: CombatChoice,
): CombatRoundResult {
	// Surrender is unconditional — it resolves regardless of what the
	// other side chose. You can't be "damaged through" a surrender.
	if (a.action === "surrender" || b.action === "surrender") {
		return {
			a: resolveSurrenderOutcome(a),
			b: resolveSurrenderOutcome(b),
		};
	}

	if (a.action === "run" || b.action === "run") {
		return resolveRoundWithRun(a, b);
	}

	return resolveAttackDefendRound(a, b);
}

/**
 * Reports whether this side surrendered — itemGiven is a flag for the
 * caller to open an item-picker UI, not a decision made here. WHICH item
 * is given up is chosen by the player (or an AI selection rule), never
 * by this module.
 */
function resolveSurrenderOutcome(choice: CombatChoice): CombatSideOutcome {
	if (choice.action !== "surrender") {
		return { damageTaken: 0, nullified: false };
	}
	return { damageTaken: 0, nullified: false, itemGiven: true };
}

/**
 * Neither side is running or surrendering — a pure Attack/Defend
 * exchange. If both chose Attack, damage genuinely flows both directions
 * in the same round (a mutual trade), computed independently for each
 * side using the OTHER side's own chosen action+card for mitigation.
 */
function resolveAttackDefendRound(
	a: CombatChoice,
	b: CombatChoice,
): CombatRoundResult {
	const aHitsB =
		a.action === "attack"
			? computeDamage(a, b)
			: { damage: 0, nullified: false };
	const bHitsA =
		b.action === "attack"
			? computeDamage(b, a)
			: { damage: 0, nullified: false };

	return {
		a: { damageTaken: bHitsA.damage, nullified: bHitsA.nullified },
		b: { damageTaken: aHitsB.damage, nullified: aHitsB.nullified },
	};
}

/**
 * Damage `attacker` deals to `defender`, given attacker chose Attack.
 * Defender's mitigation depends entirely on THEIR OWN chosen action —
 * the "hedge" (half-value) formula if they also chose Attack, the full
 * formula if they chose Defend.
 */
function computeDamage(
	attacker: CombatChoice,
	defender: CombatChoice,
): { damage: number; nullified: boolean } {
	const attackValue = computeAttackValue(attacker.stats.attack, attacker.card);

	const { value: defenseValue, nullified } =
		defender.action === "defend"
			? computeFullDefense(defender.stats.defense, defender.card)
			: computeHedgeDefense(defender.stats.defense, defender.card);

	if (nullified) return { damage: 0, nullified: true };
	return { damage: Math.max(0, attackValue - defenseValue), nullified: false };
}

/**
 * A round where at least one side chose Run.
 */
function resolveRoundWithRun(
	a: CombatChoice,
	b: CombatChoice,
): CombatRoundResult {
	const aRuns = a.action === "run";
	const bRuns = b.action === "run";

	if (aRuns && bRuns) {
		// Both sides choosing to leave means nothing is actually contesting
		// either escape — a speed roll only makes sense when one side is
		// trying to prevent the other from leaving.
		return {
			a: { damageTaken: 0, nullified: false, escaped: true },
			b: { damageTaken: 0, nullified: false, escaped: true },
		};
	}

	const runner = aRuns ? a : b;
	const other = aRuns ? b : a;
	const runResult = attemptRun(runner, other);

	const runnerDamage =
		!runResult.success && other.action === "attack"
			? computeCaughtRunDamage(other, runner)
			: 0;

	const runnerOutcome: CombatSideOutcome = {
		damageTaken: runnerDamage,
		nullified: false,
		escaped: runResult.success,
	};
	const otherOutcome: CombatSideOutcome = { damageTaken: 0, nullified: false };

	return aRuns
		? { a: runnerOutcome, b: otherOutcome }
		: { a: otherOutcome, b: runnerOutcome };
}

/** Wraps resolveRunAttempt with the opponent's effective (base + blue hedge) speed. */
function attemptRun(
	runner: CombatChoice,
	opponent: CombatChoice,
): RunAttemptResult {
	const opponentSpeed = opponent.stats.movement + computeSpeedBonus(opponent);
	return resolveRunAttempt(runner.stats.movement, opponentSpeed, runner.card);
}

/**
 * Damage a caught runner takes from an attacker. Reuses computeHedgeDefense

 *
 * Only a Yellow card actually counts here — a runner's card is normally
 * Blue (a movement value, per ALLOWED_COLORS.run), which is meaningless
 * as a defense number.
 */
function computeCaughtRunDamage(
	attacker: CombatChoice,
	runner: CombatChoice,
): number {
	const attackValue = computeAttackValue(attacker.stats.attack, attacker.card);
	const defenseCard = runner.card?.color === "yellow" ? runner.card : undefined;
	const { value: defenseValue, nullified } = computeHedgeDefense(
		runner.stats.defense,
		defenseCard,
	);

	if (nullified) return 0;
	return Math.max(0, attackValue - defenseValue);
}

// ---------- Card-value helpers ----------

/**
 * Attacker's effective attack value: base stat, or boosted by a played
 * Red card. A doubles, C multiplies by 1.5, both BEFORE defense is
 * subtracted — per `04-card-system-design.md`.
 */
function computeAttackValue(baseAttack: number, card?: CardData): number {
	if (!card) return baseAttack;
	if (card.value === "A") return baseAttack * 2;
	if (card.value === "C") return baseAttack * 1.5;
	if (typeof card.value === "number") return baseAttack + card.value;
	return baseAttack;
}

/**
 * Defense value when the card was played WHILE CHOOSING ATTACK — the
 * "hedge" case, in case the opponent also attacks this round.
 */
function computeHedgeDefense(
	baseDefense: number,
	card?: CardData,
): { value: number; nullified: boolean } {
	if (card?.value === "A") return { value: Infinity, nullified: true };
	if (card?.value === "C") return { value: baseDefense * 2, nullified: false };
	const numeric = typeof card?.value === "number" ? card.value : 0;
	return { value: baseDefense + numeric / 2, nullified: false };
}

/**
 * Defense value when the card was played WHILE CHOOSING DEFEND — full
 * numeric value, no halving.
 */
function computeFullDefense(
	baseDefense: number,
	card?: CardData,
): { value: number; nullified: boolean } {
	if (card?.value === "A") return { value: Infinity, nullified: true };
	if (card?.value === "C") return { value: baseDefense * 2, nullified: false };
	const numeric = typeof card?.value === "number" ? card.value : 0;
	return { value: baseDefense + numeric, nullified: false };
}

/** Blue card bonus — only relevant if this side chose Attack (speed hedge) or Run. */
function computeSpeedBonus(choice: CombatChoice): number {
	if (choice.action !== "attack" && choice.action !== "run") return 0;
	if (typeof choice.card?.value !== "number") return 0;
	if (choice.card.color !== "blue") return 0;
	return choice.card.value;
}

// ---------- Run ----------

export interface RunAttemptResult {
	success: boolean;
	/** True if this was a guaranteed escape via the Blue E card, not a rolled chance. */
	guaranteed: boolean;
	/** The catch chance actually used for the roll — undefined for a guaranteed escape. */
	catchChancePercent?: number;
}

/**
 * Resolve one side's Run roll against a given opponent speed.
 *
 * Playing Blue E is a guaranteed escape — no roll at all.
 */
export function resolveRunAttempt(
	runnerMovementStat: number,
	opponentMovementStat: number,
	runnerCard?: CardData,
): RunAttemptResult {
	if (runnerCard?.value === "E") {
		return { success: true, guaranteed: true };
	}

	const cardValue =
		typeof runnerCard?.value === "number" ? runnerCard.value : 0;
	const runnerSpeed = runnerMovementStat + cardValue;
	const ratio = runnerSpeed / Math.max(1, opponentMovementStat);

	const catchChancePercent = clamp(50 / ratio, 25, 75);
	const roll = Math.random() * 100;
	const success = roll >= catchChancePercent;

	return { success, guaranteed: false, catchChancePercent };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

// ---------- Zone of Control ----------

/**
 * A ZoC reaction strike — the attacking side never plays a card (base
 * stat only), matching the existing locked rule. Uses the FULL defense
 * formula (not the attack-hedge half rule)
 */
export function resolveReactionStrike(
	attackerStats: MercenaryStats,
	defenderStats: MercenaryStats,
	defenderCard?: CardData,
): { damage: number; nullified: boolean } {
	const attackValue = computeAttackValue(attackerStats.attack, undefined);
	const { value: defenseValue, nullified } = computeFullDefense(
		defenderStats.defense,
		defenderCard,
	);

	if (nullified) return { damage: 0, nullified: true };
	return {
		damage: Math.max(0, attackValue - defenseValue) / 2,
		nullified: false,
	};
}

// ---------- Defeat & Surrender consequences ----------

export interface DefeatConsequence {
	teleport: true;
	/** Half of max HP — a hard ceiling until healing is found, not just a starting value. */
	hpCeiling: number;
	/** Only true when defeated by another hunter in combat, never a monster. */
	itemStolen: boolean;
}

/**
 * Consequence of HP hitting 0 during a round. Item theft only happens
 * hunter-vs-hunter — monsters don't loot
 */
export function resolveDefeat(
	loserStats: MercenaryStats,
	defeatedByHunter: boolean,
): DefeatConsequence {
	return {
		teleport: true,
		hpCeiling: Math.floor(loserStats.maxHp / 2),
		itemStolen: defeatedByHunter,
	};
}

export interface SurrenderConsequence {
	teleport: true;
	/** No HP ceiling — surrender keeps your current HP, unlike a real defeat. */
	itemGiven: boolean;
}

/**
 * Pre-check utility for whether a Surrender even has an item to give up
 */
export function resolveSurrender(itemCount: number): SurrenderConsequence {
	return { teleport: true, itemGiven: itemCount > 0 };
}
