import type { MovementRangeEntry } from "../game/movement";
import type { MercenaryStats } from "../types/mercenary";
import type { CardData } from "../game/card";
import type { ItemData } from "../game/item";
import type { CombatAction, CombatChoice } from "../game/combat";
import type { GridCoord } from "../game/grid";
import type { AiMemory } from "./aiMemory";

/** Hostile hunter behavior profile */
export type AiArchetype = "aggressive" | "treasure" | "balanced";

export const ARCHETYPE_COLORS: Record<AiArchetype, number> = {
	aggressive: 0xe67e22,
	treasure: 0x9b59b6,
	balanced: 0x1abc9c,
};

export function archetypeLabel(archetype: AiArchetype): string {
	const names: Record<AiArchetype, string> = {
		aggressive: "Aggressive Hunter",
		treasure: "Treasure Hunter",
		balanced: "Balanced Hunter",
	};
	return names[archetype];
}

export type AiFallbackAction = "rest" | "retreat" | "hold";

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
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
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
 * Smallest Blue movement card that closes the gap to the target — not
 * just the strongest one held, so bigger cards stay saved for when a
 * smaller one genuinely wouldn't reach. If nothing covers the full gap,
 * falls back to the strongest available, to get as close as possible.
 * Returns undefined if base movement already reaches on its own.
 */
export function decideMovementCard(
	hand: CardData[],
	baseMovement: number,
	distanceNeeded: number,
): CardData | undefined {
	const gap = distanceNeeded - baseMovement;
	if (gap <= 0) return undefined;

	const blueCards = hand.filter(
		(c): c is CardData & { value: number } =>
			c.color === "blue" && typeof c.value === "number",
	);
	if (blueCards.length === 0) return undefined;

	const sufficientCards = blueCards.filter((c) => c.value >= gap);
	if (sufficientCards.length > 0) {
		return sufficientCards.reduce((a, b) => (b.value < a.value ? b : a));
	}

	return blueCards.reduce((a, b) => (b.value > a.value ? b : a));
}

/**
 * Fallback when nothing's worth fighting this turn. Adjacent-threat
 * behavior is archetype-specific, not just "flee if possible": Aggressive
 * stands ground and heals (accepting the enemy might engage next turn)
 * rather than running; Balanced/Treasure genuinely flee via Disengage
 * (ZoC-immune) when they can afford it, falling back to Rest if they
 * can't, and only holding position if neither is affordable.
 */
export function decideFallbackAction(
	self: AiCombatant,
	adjacentThreats: AiCombatant[],
	archetype: AiArchetype,
	canAffordDisengage: boolean,
	canAffordRest: boolean,
): AiFallbackAction {
	if (adjacentThreats.length === 0) {
		const hpRatio = self.currentHp / Math.max(1, self.stats.maxHp);
		return canAffordRest && hpRatio < 0.5 ? "rest" : "hold";
	}

	if (archetype === "aggressive") {
		// Stands its ground and heals rather than fleeing — accepts the
		// adjacent threat might engage next turn, doesn't retreat from it.
		return canAffordRest ? "rest" : "hold";
	}

	if (canAffordDisengage) return "retreat";
	if (canAffordRest) return "rest";
	return "hold";
}

/**
 * Reachable tile that best escapes `threat`. Two-tier: first find the
 * best achievable distance from the threat (the survival floor — never
 * compromised, even if that means moving back the way it came). Only
 * among tiles near that best distance does continuity (matching the
 * last flee direction) break the tie.
 */
export function pickRetreatTile(
	range: Map<string, MovementRangeEntry>,
	threat: GridCoord,
	selfCoord: GridCoord,
	memory: AiMemory,
): GridCoord | null {
	let bestDist = -Infinity;
	for (const entry of range.values()) {
		const dist =
			Math.abs(entry.coord.x - threat.x) + Math.abs(entry.coord.y - threat.y);
		if (dist > bestDist) bestDist = dist;
	}

	const DISTANCE_TOLERANCE = 1;
	let best: GridCoord | null = null;
	let bestContinuity = -Infinity;

	for (const entry of range.values()) {
		const dist =
			Math.abs(entry.coord.x - threat.x) + Math.abs(entry.coord.y - threat.y);
		if (dist < bestDist - DISTANCE_TOLERANCE) continue;

		let continuity = 0;
		if (memory.lastFleeDirection) {
			const moveX = entry.coord.x - selfCoord.x;
			const moveY = entry.coord.y - selfCoord.y;
			continuity =
				moveX * memory.lastFleeDirection.x + moveY * memory.lastFleeDirection.y;
		}

		if (continuity > bestContinuity) {
			bestContinuity = continuity;
			best = entry.coord;
		}
	}

	return best;
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

		const score = engagementScore(archetype, self, candidate);
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}

	return best;
}

/** Higher = more attractive fight for this archetype. */
function engagementScore(
	archetype: AiArchetype,
	self: AiCombatant,
	opponent: AiCombatant,
): number {
	const oppHpRatio = opponent.currentHp / Math.max(1, opponent.stats.maxHp);
	const ownPower = self.stats.attack + self.stats.defense + self.stats.movement;
	const oppPower =
		opponent.stats.attack + opponent.stats.defense + opponent.stats.movement;
	const powerEdge = ownPower / Math.max(1, oppPower);
	const loot = opponent.items.length;

	switch (archetype) {
		case "aggressive":
			// Prefer targets we're most likely to beat
			return powerEdge * 3 + (1 - oppHpRatio) * 2;
		case "treasure":
			// Rare fights: lean loot when the bar already passed
			return loot * 3 + powerEdge;
		case "balanced":
		default:
			// Opportunist: loot + soft matchup + hurt targets
			return loot * 2 + powerEdge + (1 - oppHpRatio);
	}
}

/** Relative strength for card pick — specials outrank numerics. */
function cardStrength(card: CardData): number {
	if (card.value === "A") return 100;
	if (card.value === "C") return 90;
	return typeof card.value === "number" ? card.value : 0;
}

/**
 * In-combat action: Attack/Defend bias by archetype, then strongest legal
 * card. Flees when badly hurt or heavily outmatched — Run if movement
 * gives a real chance to escape, Surrender (guaranteed, costs an item)
 * if it doesn't.
 */
export function chooseCombatAction(
	hand: CardData[],
	stats: MercenaryStats,
	archetype: AiArchetype = "balanced",
	currentHp?: number,
	opponentStats?: MercenaryStats,
	canAttack: boolean = true,
): CombatChoice {
	if (currentHp !== undefined) {
		const hpRatio = currentHp / Math.max(1, stats.maxHp);

		let fleeThreshold = 0.3;
		if (archetype === "aggressive") fleeThreshold = 0.15;
		if (archetype === "treasure") fleeThreshold = 0.45;

		let shouldFlee = hpRatio < fleeThreshold;

		if (opponentStats) {
			const ownPower = stats.attack + stats.defense + stats.movement;
			const oppPower =
				opponentStats.attack + opponentStats.defense + opponentStats.movement;
			if (oppPower > ownPower * 1.5) shouldFlee = true;
		}

		if (shouldFlee) {
			// Run's catch-chance worsens sharply once the runner's movement
			// falls meaningfully below the opponent's — at that point a
			// contested escape is more likely to fail than a guaranteed
			// Surrender is to cost more than one item.
			const canLikelyEscape =
				!opponentStats || stats.movement > opponentStats.movement * 0.75;

			if (!canLikelyEscape) {
				return { action: "surrender", stats };
			}

			const blueCards = hand.filter((c) => c.color === "blue");
			const card = blueCards.length
				? blueCards.reduce((a, b) =>
						cardStrength(b) > cardStrength(a) ? b : a,
					)
				: undefined;
			return { action: "run", stats, card };
		}
	}

	let attackChance = 0.5;
	if (archetype === "aggressive") attackChance = 0.75;
	if (archetype === "treasure") attackChance = 0.35;

	const action: CombatAction =
		canAttack && Math.random() < attackChance ? "attack" : "defend";
	const wantedColor = action === "attack" ? "red" : "yellow";

	const candidates = hand.filter((c) => c.color === wantedColor);
	const best = candidates.length
		? candidates.reduce((a, b) => (cardStrength(b) > cardStrength(a) ? b : a))
		: undefined;

	return { action, stats, card: best };
}

/**
 * Which item index a winning AI takes from the loser. Always prioritizes
 * the match's target/relic item if present; otherwise picks randomly
 * among whatever's actually filled, not just the first slot.
 */
export function decideLootChoice(
	loserItems: (ItemData | null)[],
	targetItemId: string | null,
): number | null {
	if (targetItemId) {
		const targetIndex = loserItems.findIndex((i) => i?.id === targetItemId);
		if (targetIndex !== -1) return targetIndex;
	}

	const filledIndices = loserItems
		.map((item, index) => (item !== null ? index : -1))
		.filter((index) => index !== -1);

	if (filledIndices.length === 0) return null;
	return filledIndices[Math.floor(Math.random() * filledIndices.length)];
}

/**
 * Which item index a surrendering AI gives up. Never the match's
 * target/relic item while any other item exists to give instead — only
 * surrenders the target if it's genuinely the only item held.
 */
export function decideSurrenderChoice(
	giverItems: (ItemData | null)[],
	targetItemId: string | null,
): number | null {
	const filledIndices = giverItems
		.map((item, index) => (item !== null ? index : -1))
		.filter((index) => index !== -1);

	if (filledIndices.length === 0) return null;

	if (targetItemId) {
		const nonTargetIndices = filledIndices.filter(
			(i) => giverItems[i]?.id !== targetItemId,
		);
		if (nonTargetIndices.length > 0) {
			return nonTargetIndices[
				Math.floor(Math.random() * nonTargetIndices.length)
			];
		}
		// Only the target item remains — forced to give it up.
	}

	return filledIndices[Math.floor(Math.random() * filledIndices.length)];
}
