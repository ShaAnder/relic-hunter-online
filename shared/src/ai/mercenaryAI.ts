import type { MovementRangeEntry } from "../world/movement";
import type { MercenaryStats, CharacterClass } from "../types/mercenary";
import type { CardData } from "../cards/card";
import type { ItemData } from "../items/item";
import type { CombatAction, CombatChoice } from "../combat/combat";
import type { GridCoord } from "../world/grid";
import type { AiMemory } from "./aiMemory";
import type { EntityCore } from "../types/entity";

/** Hostile hunter behavior profile */
export type AiArchetype = "aggressive" | "treasure" | "balanced";

/** AI Inventory slots for gauging leave potential */
const AI_INVENTORY_SLOTS = 6;

export const ARCHETYPE_COLORS: Record<AiArchetype, number> = {
	aggressive: 0xe67e22,
	treasure: 0x9b59b6,
	balanced: 0x1abc9c,
};

/**
 * Empty general slots. AiCombatant.items is already filtered to non-null
 * by toCombatant, so length is filled count — not an array with holes.
 */
function emptyItemSlots(self: AiCombatant): number {
	return Math.max(0, AI_INVENTORY_SLOTS - self.items.length);
}

export function hunterLabel(
	name: string,
	archetype: AiArchetype,
	characterClass: CharacterClass,
): string {
	const archetypeCap = archetype.charAt(0).toUpperCase() + archetype.slice(1);
	const classCap =
		characterClass.charAt(0).toUpperCase() + characterClass.slice(1);
	return `${name}, ${archetypeCap} ${classCap}`;
}

export type AiFallbackAction = "rest" | "retreat" | "hold";

/** Minimal unit snapshot the AI reasons over — no Pixi, no scene refs. */
export type AiCombatant = EntityCore & { items: ItemData[] };

export interface ChestInfo {
	coord: GridCoord;
	isOpen: boolean;
}

/** Manhattan distance — matches cardinal-only movement cost on this grid. */
function manhattanDistance(a: GridCoord, b: GridCoord): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function countNearby(
	from: GridCoord,
	coords: GridCoord[],
	radius: number,
): number {
	let n = 0;
	for (const c of coords) {
		if (manhattanDistance(from, c) <= radius) n++;
	}
	return n;
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
 * When THIS hunter holds the relic: archetype-weighted extract vs linger.
 * Treasure fills bags first; Aggressive fights until cornered;
 * Balanced bails under monster pressure or low HP.
 */
function decideCarrierTarget(
	archetype: AiArchetype,
	self: AiCombatant,
	living: AiCombatant[],
	chests: ChestInfo[],
	exitCoord: GridCoord | null,
	monsterCoords: GridCoord[],
	memory: AiMemory | null,
): GridCoord {
	const hpRatio = self.currentHp / Math.max(1, self.stats.maxHp);
	const foe = nearestOther(self.coord, living);
	const chest = nearestUnopenedChest(self.coord, chests);
	const goExit = (): GridCoord => exitCoord ?? self.coord;

	const markExtract = () => {
		if (memory) memory.extracting = true;
	};

	// Sticky: already committed to leaving — don't dither.
	if (memory?.extracting && exitCoord) {
		return goExit();
	}

	// Stolen-relic panic: any living hunter within 3 tiles → leave now.
	const threatened = living.some(
		(o) => manhattanDistance(self.coord, o.coord) <= 3,
	);
	if (threatened && exitCoord) {
		markExtract();
		return goExit();
	}

	switch (archetype) {
		case "treasure": {
			// 4+ items already: diminishing returns — extract.
			if (self.items.length >= 4) {
				markExtract();
				return goExit();
			}
			if (emptyItemSlots(self) > 0 && chest) return chest;
			markExtract();
			return goExit();
		}
		case "aggressive": {
			const cornered = hpRatio < 0.3 || (hpRatio < 0.5 && living.length >= 2);
			if (cornered) {
				const exitDist = exitCoord
					? manhattanDistance(self.coord, exitCoord)
					: Infinity;
				// Exit too far and not critical yet → keep fighting locally.
				if (exitDist > 12 && hpRatio >= 0.25 && foe) {
					return foe.coord;
				}
				markExtract();
				return goExit();
			}
			if (foe) return foe.coord;
			markExtract();
			return goExit();
		}
		case "balanced":
		default: {
			const nearbyMonsters = countNearby(self.coord, monsterCoords, 7);
			if (nearbyMonsters >= 2 || hpRatio < 0.4) {
				markExtract();
				return goExit();
			}
			if (foe && manhattanDistance(self.coord, foe.coord) <= 4) {
				return foe.coord;
			}
			markExtract();
			return goExit();
		}
	}
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
	exitCoord: GridCoord | null = null,
	monsterCoords: GridCoord[] = [],
	memory: AiMemory | null = null,
): GridCoord {
	const living = others.filter((o) => o.currentHp > 0);
	const carrier = findCarrier(self, living, targetItemId);

	if (carrier && carrier.id === self.id) {
		return decideCarrierTarget(
			archetype,
			self,
			living,
			chests,
			exitCoord,
			monsterCoords,
			memory,
		);
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
		// Lowered from 0.5 — resting at "just under half HP" was
		// triggering too readily and often needed several consecutive
		// rests to climb back over the line, reading as spam. 0.25 means
		// a hunter only stops to rest when meaningfully hurt.
		return canAffordRest && hpRatio < 0.25 ? "rest" : "hold";
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
	inRangeKeys: Set<string>,
): AiCombatant | null {
	const inRange = others.filter(
		(o) => o.currentHp > 0 && inRangeKeys.has(`${o.coord.x},${o.coord.y}`),
	);
	if (inRange.length === 0) return null;

	let best: AiCombatant | null = null;
	let bestScore = -Infinity;

	for (const candidate of inRange) {
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
 * Context bag for in-combat AI. Prefer this over a long positional arg
 * list so callers can pass only what they know (exit distance, etc.)
 * without breaking older call sites mid-migration.
 */
export interface CombatAiContext {
	/** Live HP for this side. */
	currentHp: number;
	/** Opponent stats when known — used for power / run checks. */
	opponentStats?: MercenaryStats;
	/** False when this side cannot legally Attack (e.g. ranged lock). */
	canAttack?: boolean;
	/** Opponent is a monster — soft bias, not a hard ban on surrender. */
	againstMonster?: boolean;
	/**
	 * This side initiated the fight / spent Attack AP to open it.
	 * Blocks free surrender on the opening exchange so AI does not
	 * walk in and immediately fold.
	 */
	committed?: boolean;
	/** Holding the match target item. */
	carryingRelic?: boolean;
	/** Manhattan (or approx) distance to revealed Exit; null if none. */
	exitDistance?: number | null;
	/** Distance to the current relic carrier if someone else holds it. */
	carrierDistance?: number | null;
	/** Filled inventory slots — surrender costs a real item when > 0. */
	itemCount?: number;
}

/**
 * Pick the strongest hand card matching the wanted colors for an action.
 */
function bestCardFor(
	hand: CardData[],
	colors: CardData["color"][],
): CardData | undefined {
	const candidates = hand.filter((c) => colors.includes(c.color));
	if (candidates.length === 0) return undefined;
	return candidates.reduce((a, b) =>
		cardStrength(b) > cardStrength(a) ? b : a,
	);
}

/**
 * In-combat action selection with scored options.
 *
 * Design:
 * - Surrender is a *tool* (escape / random teleport), not a panic default
 *   and not banned. Prefer Run when speed works; Attack/Defend when the
 *   matchup is fine.
 * - Favored or even power + decent HP → stay in the fight.
 * - Committed initiators do not free-surrender on the opening exchange.
 * - Optional tactical warp: losing locally while an objective is far can
 *   raise surrender as a reposition gamble (aggressive cross-map case).
 * - againstMonster softens surrender (no loot for them) but still allows
 *   it when critically stuck so the teleport remains available.
 *
 * @param hand - this side's cards
 * @param stats - this side's stats (also stamped onto the returned choice)
 * @param archetype - aggressive | treasure | balanced
 * @param ctx - HP, opponent, commitment, objective distances, etc.
 * @author ShaAnder
 */
export function chooseCombatAction(
	hand: CardData[],
	stats: MercenaryStats,
	archetype: AiArchetype,
	ctx: CombatAiContext,
): CombatChoice {
	const currentHp = ctx.currentHp;
	const opponentStats = ctx.opponentStats;
	const canAttack = ctx.canAttack !== false;
	const againstMonster = ctx.againstMonster === true;
	const committed = ctx.committed === true;
	const itemCount = ctx.itemCount ?? 0;
	const exitDistance = ctx.exitDistance ?? null;
	const carrierDistance = ctx.carrierDistance ?? null;

	const hpRatio = currentHp / Math.max(1, stats.maxHp);
	const ownPower = stats.attack + stats.defense + stats.movement;
	const oppPower = opponentStats
		? opponentStats.attack + opponentStats.defense + opponentStats.movement
		: ownPower;
	const powerRatio = ownPower / Math.max(1, oppPower);

	const canLikelyEscape =
		!opponentStats || stats.movement > opponentStats.movement * 0.75;

	let fleeThreshold = 0.25;
	if (archetype === "aggressive") fleeThreshold = 0.12;
	if (archetype === "treasure") fleeThreshold = 0.4;

	const criticallyLow = hpRatio < fleeThreshold;
	const badlyOutmatched = powerRatio < 0.55;
	const favoredOrEven = powerRatio >= 0.9 && hpRatio >= 0.25;

	// Score each legal action; pick the highest. Small random jitter
	// breaks ties so two equal options do not always resolve the same way.
	const scores: { action: CombatAction; score: number }[] = [];

	// --- Attack / Defend (stay in the fight) ---
	let attackBase = 50;
	let defendBase = 50;
	if (archetype === "aggressive") {
		attackBase = 70;
		defendBase = 35;
	} else if (archetype === "treasure") {
		attackBase = 35;
		defendBase = 60;
	}
	if (favoredOrEven) {
		attackBase += 20;
		defendBase += 10;
	}
	if (badlyOutmatched) {
		attackBase -= 25;
		defendBase -= 5;
	}
	if (criticallyLow) {
		attackBase -= 30;
		defendBase -= 10;
	}
	if (!canAttack) {
		attackBase = -Infinity;
	}

	scores.push({ action: "attack", score: attackBase });
	scores.push({ action: "defend", score: defendBase });

	// --- Run ---
	let runScore = -20;
	if (canLikelyEscape) {
		runScore = 40;
		if (criticallyLow) runScore += 30;
		if (badlyOutmatched) runScore += 20;
		if (archetype === "treasure") runScore += 10;
		if (archetype === "aggressive") runScore -= 10;
	} else {
		// Unlikely escape — still slightly better than nothing when dying
		if (criticallyLow) runScore = 10;
	}
	scores.push({ action: "run", score: runScore });

	// --- Surrender (tool: guaranteed leave + teleport, costs an item) ---
	let surrenderScore = -40;
	if (!favoredOrEven) {
		if (criticallyLow && !canLikelyEscape) surrenderScore = 55;
		else if (badlyOutmatched && !canLikelyEscape) surrenderScore = 45;
		else if (criticallyLow) surrenderScore = 25;
	}
	// Opening exchange you walked into — do not free-fold.
	if (committed) surrenderScore -= 50;
	// Soft bias vs monsters (no loot transfer); still allow when critical.
	if (againstMonster && !criticallyLow) surrenderScore -= 25;
	// Paying an item hurts treasure more.
	if (itemCount > 0 && archetype === "treasure") surrenderScore -= 10;
	// Tactical warp: objective far, local fight is a dead end.
	const objectiveFar =
		(exitDistance !== null && exitDistance > 10) ||
		(carrierDistance !== null && carrierDistance > 10);
	if (objectiveFar && !canLikelyEscape && powerRatio < 0.7) {
		surrenderScore += 20;
		if (archetype === "aggressive") surrenderScore += 10;
	}
	scores.push({ action: "surrender", score: surrenderScore });

	// Jitter + pick
	let bestAction: CombatAction = "defend";
	let bestScore = -Infinity;
	for (const row of scores) {
		if (row.score === -Infinity) continue;
		const jittered = row.score + Math.random() * 4;
		if (jittered > bestScore) {
			bestScore = jittered;
			bestAction = row.action;
		}
	}

	if (bestAction === "attack") {
		return {
			action: "attack",
			stats,
			card: bestCardFor(hand, ["red"]),
		};
	}
	if (bestAction === "defend") {
		return {
			action: "defend",
			stats,
			card: bestCardFor(hand, ["yellow"]),
		};
	}
	if (bestAction === "run") {
		return {
			action: "run",
			stats,
			card: bestCardFor(hand, ["blue", "yellow"]),
		};
	}
	return { action: "surrender", stats };
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
