import type { GridCoord } from "../game/grid";
import type { MercenaryStats } from "../types/mercenary";
import type { CardData } from "../game/card";
import type { ItemData } from "../game/item";
import type { CombatAction, CombatChoice } from "../game/combat";

/** Hostile hunter behavior profile — see `09-enemy-ai-design-v3.md`. */
export type AiArchetype = "aggressive" | "treasure" | "balanced";

/** Minimal unit snapshot the AI reasons over — no Pixi, no scene refs. */
export interface AiCombatant {
	id: string;
	coord: GridCoord;
	stats: MercenaryStats;
	currentHp: number;
	items: ItemData[];
}

export interface ChestInfo {
	coord: GridCoord;
	isOpen: boolean;
}

/** Manhattan distance — matches cardinal-only movement cost on this grid. */
function manhattanDistance(a: GridCoord, b: GridCoord): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** True if this combatant's inventory holds the match target item. */
function carriesTarget(
	combatant: AiCombatant,
	targetItemId: string | null,
): boolean {
	if (!targetItemId) return false;
	return combatant.items.some((item) => item.id === targetItemId);
}

/** Living combatant (if any) currently holding the match target. */
function findCarrier(
	self: AiCombatant,
	others: AiCombatant[],
	targetItemId: string | null,
): AiCombatant | null {
	if (!targetItemId) return null;
	if (carriesTarget(self, targetItemId)) return self;
	for (const other of others) {
		if (other.currentHp <= 0) continue;
		if (carriesTarget(other, targetItemId)) return other;
	}
	return null;
}

/** Nearest living other by Manhattan distance, or null. */
function nearestOther(
	from: GridCoord,
	others: AiCombatant[],
): AiCombatant | null {
	let best: AiCombatant | null = null;
	let bestDist = Infinity;
	for (const other of others) {
		if (other.currentHp <= 0) continue;
		const dist = manhattanDistance(from, other.coord);
		if (dist < bestDist) {
			bestDist = dist;
			best = other;
		}
	}
	return best;
}

/** Nearest unopened chest, or null if none remain. */
function nearestUnopenedChest(
	from: GridCoord,
	chests: ChestInfo[],
): GridCoord | null {
	let best: GridCoord | null = null;
	let bestDist = Infinity;
	for (const chest of chests) {
		if (chest.isOpen) continue;
		const dist = manhattanDistance(from, chest.coord);
		if (dist < bestDist) {
			bestDist = dist;
			best = chest.coord;
		}
	}
	return best;
}

/**
 * Chebyshev adjacency (range 1) — matches overworld attack range checks.
 * @param a - first tile
 * @param b - second tile
 */
export function isAdjacent(a: GridCoord, b: GridCoord): boolean {
	return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
}

/**
 * Movement goal for one AI hunter given the full living field.
 * Carrier of the match target (any hunter) overrides default goals for
 * Aggressive and Balanced; Treasure still prefers loot / soft shadow.
 * @param archetype - aggressive | treasure | balanced
 * @param self - the hunter taking this turn
 * @param others - all other living combatants (player + AI + later monsters)
 * @param chests - open-state snapshot of map chests
 * @param targetItemId - match target item id, or null if none
 * @author ShaAnder
 */
export function decideMovementTarget(
	archetype: AiArchetype,
	self: AiCombatant,
	others: AiCombatant[],
	chests: ChestInfo[],
	targetItemId: string | null,
): GridCoord {
	const living = others.filter((o) => o.currentHp > 0);
	const carrier = findCarrier(self, living, targetItemId);

	if (carrier && carrier.id === self.id) {
		if (archetype === "treasure") {
			const chest = nearestUnopenedChest(self.coord, chests);
			return chest ?? self.coord;
		}
		const foe = nearestOther(self.coord, living);
		return foe?.coord ?? self.coord;
	}

	if (carrier) {
		if (archetype === "treasure") {
			const chest = nearestUnopenedChest(self.coord, chests);
			const distToCarrier = manhattanDistance(self.coord, carrier.coord);
			if (chest && distToCarrier > 3) return chest;
			return carrier.coord;
		}
		return carrier.coord;
	}

	switch (archetype) {
		case "aggressive": {
			const foe = nearestOther(self.coord, living);
			return foe?.coord ?? self.coord;
		}
		case "treasure": {
			const chest = nearestUnopenedChest(self.coord, chests);
			return chest ?? self.coord;
		}
		case "balanced":
		default: {
			const foe = nearestOther(self.coord, living);
			const chest = nearestUnopenedChest(self.coord, chests);
			if (!foe && !chest) return self.coord;
			if (!foe) return chest!;
			if (!chest) return foe.coord;
			const distFoe = manhattanDistance(self.coord, foe.coord);
			const distChest = manhattanDistance(self.coord, chest);
			return distChest < distFoe ? chest : foe.coord;
		}
	}
}

/**
 * Whether to open combat against a specific opponent while adjacent.
 * @param archetype - AI profile
 * @param self - attacker snapshot
 * @param opponent - defender snapshot
 */
export function decideEngagement(
	archetype: AiArchetype,
	self: AiCombatant,
	opponent: AiCombatant,
): boolean {
	if (opponent.currentHp <= 0) return false;

	const hpRatio = self.currentHp / Math.max(1, self.stats.maxHp);
	const itemScore = Math.min(1, opponent.items.length / 6);
	const ownPower = self.stats.attack + self.stats.defense + self.stats.movement;
	const oppPower =
		opponent.stats.attack + opponent.stats.defense + opponent.stats.movement;
	const powerRatio = Math.min(2, ownPower / Math.max(1, oppPower)) / 2;
	const score = hpRatio * 0.4 + itemScore * 0.3 + powerRatio * 0.3;

	switch (archetype) {
		case "aggressive":
			return hpRatio >= 0.25;
		case "treasure":
			return score >= 0.7;
		case "balanced":
		default:
			return score >= 0.5;
	}
}

/**
 * Pick which adjacent living foe to fight, or null to skip combat this turn.
 * @param archetype - AI profile
 * @param self - the hunter deciding
 * @param others - full field (non-adjacent entries are ignored)
 */
export function pickEngagementTarget(
	archetype: AiArchetype,
	self: AiCombatant,
	others: AiCombatant[],
): AiCombatant | null {
	const adjacent = others.filter(
		(o) => o.currentHp > 0 && isAdjacent(self.coord, o.coord),
	);
	if (adjacent.length === 0) return null;

	let best: AiCombatant | null = null;
	let bestScore = -Infinity;

	for (const candidate of adjacent) {
		if (!decideEngagement(archetype, self, candidate)) continue;

		const hpRatio = candidate.currentHp / Math.max(1, candidate.stats.maxHp);
		const loot = candidate.items.length;
		const score = loot * 2 + (1 - hpRatio);
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}

	return best;
}

/** Relative strength for card pick — specials outrank numerics. */
function cardStrength(card: CardData): number {
	if (card.value === "A") return 100;
	if (card.value === "C") return 90;
	return typeof card.value === "number" ? card.value : 0;
}

/**
 * In-combat action: Attack/Defend bias by archetype, then strongest legal card.
 * @param hand - fighter's current hand
 * @param stats - fighter combat stats
 * @param archetype - behavior bias
 */
export function chooseCombatAction(
	hand: CardData[],
	stats: MercenaryStats,
	archetype: AiArchetype = "balanced",
): CombatChoice {
	let attackChance = 0.5;
	if (archetype === "aggressive") attackChance = 0.75;
	if (archetype === "treasure") attackChance = 0.35;

	const action: CombatAction =
		Math.random() < attackChance ? "attack" : "defend";
	const wantedColor = action === "attack" ? "red" : "yellow";

	const candidates = hand.filter((c) => c.color === wantedColor);
	const best = candidates.length
		? candidates.reduce((a, b) => (cardStrength(b) > cardStrength(a) ? b : a))
		: undefined;

	return { action, stats, card: best };
}
