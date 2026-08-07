import type { MercenaryState, MercenaryStats } from "../types/mercenary";
import { createMercenary } from "../types/mercenary";
import { CharacterClass } from "../types/mercenary";

export const MELEE_CLASSES: ReadonlySet<CharacterClass> = new Set([
	"tank",
	"brawler",
]);

export const RANGED_CLASSES: ReadonlySet<CharacterClass> = new Set([
	"hunter",
	"scout",
]);

export const CASTER_CLASSES: ReadonlySet<CharacterClass> = new Set([
	"mage",
	"summoner",
]);

/** Ranged classes don't project a Zone of Control, but can initiate combat from outside melee range. */
export function isRangedClass(characterClass: CharacterClass): boolean {
	return RANGED_CLASSES.has(characterClass);
}

export function isMeleeClass(characterClass: CharacterClass): boolean {
	return MELEE_CLASSES.has(characterClass);
}

export function isCasterClass(characterClass: CharacterClass): boolean {
	return CASTER_CLASSES.has(characterClass);
}

/* Raw point allowcation chosen at creation - units of the stat not pts spent */
export interface StatAllocation {
	movement: number;
	attack: number;
	defense: number;
	hp: number;
}

/* Saved playale character Stats cached at creation */
export interface CharacterData {
	id: string;
	name: string;
	characterClass: CharacterClass;
	// placeholder shape until we get art
	modelIndex: number;
	pointsSpent: StatAllocation;
	stats: MercenaryStats;
	createdAt: number;
}

export const UNIVERSAL_BASE: MercenaryStats = {
	movement: 2,
	attack: 3,
	defense: 1,
	maxHp: 15,
	ap: 3,
};

/* Character creation PT budget */
export const CHAR_POINT_BUDGET = 12;

//** Cost of allocating the Kth point into a stat — escalates by 1 every `interval` points, so later points cost progressively more. */
function costOfPoint(k: number, interval: number): number {
	return Math.ceil(k / interval);
}

const ESCALATION_INTERVAL: Record<keyof StatAllocation, number> = {
	movement: 1,
	attack: 2,
	defense: 2,
	hp: 3,
};

function cumulativeCost(points: number, interval: number): number {
	let total = 0;
	for (let k = 1; k <= points; k++) {
		total += costOfPoint(k, interval);
	}
	return total;
}

export function totalPointsSpent(allocation: StatAllocation): number {
	return (
		cumulativeCost(allocation.movement, ESCALATION_INTERVAL.movement) +
		cumulativeCost(allocation.attack, ESCALATION_INTERVAL.attack) +
		cumulativeCost(allocation.defense, ESCALATION_INTERVAL.defense) +
		cumulativeCost(allocation.hp, ESCALATION_INTERVAL.hp)
	);
}

export function computeCharacterStats(
	characterClass: CharacterClass,
	pointsSpent: StatAllocation,
): MercenaryStats {
	return {
		movement: UNIVERSAL_BASE.movement + pointsSpent.movement,
		attack: UNIVERSAL_BASE.attack + pointsSpent.attack,
		defense: UNIVERSAL_BASE.defense + pointsSpent.defense,
		maxHp: UNIVERSAL_BASE.maxHp + pointsSpent.hp * 3,
		ap: UNIVERSAL_BASE.ap,
	};
}

/* Build a full charData record computing and caching final stats */
export function createCharacter(
	name: string,
	characterClass: CharacterClass,
	pointsSpent: StatAllocation,
	modelIndex: number,
): CharacterData {
	return {
		id: generateId(),
		name,
		characterClass,
		modelIndex,
		pointsSpent,
		stats: computeCharacterStats(characterClass, pointsSpent),
		createdAt: Date.now(),
	};
}

/** Portable id — works in browser and Node without requiring crypto.randomUUID. */
function generateId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}

	// Fallback: timestamp + random suffix (unique enough for local saves)
	return `char_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Spawn a fresh MercenaryState for a match from a persistent CharacterData.
 * This is the seam between "character sheet" (survives between matches / data change)
 */
export function spawnFromCharacter(
	character: CharacterData,
	coord: MercenaryState["coord"],
): MercenaryState {
	return createMercenary(character.id, coord, character.stats);
}
