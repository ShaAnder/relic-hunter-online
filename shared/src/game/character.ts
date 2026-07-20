import type { MercenaryState, MercenaryStats } from "../types/mercenary";
import { createMercenary } from "../types/mercenary";

export type CharacterClass =
	| "tank"
	| "brawler"
	| "hunter"
	| "scout"
	| "mage"
	| "summoner";

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
	movement: 1,
	attack: 1,
	defense: 1,
	maxHp: 15,
	ap: 3,
};

/**
 * Per class stat modifiers
 * specific classes start with higher baselines, to accomodate for weaknesses
 */
export const CLASS_MODIFIERS: Record<CharacterClass, MercenaryStats> = {
	tank: { movement: 0, attack: 0, defense: 2, maxHp: 0, ap: 0 },
	brawler: { movement: 0, attack: 2, defense: 0, maxHp: 0, ap: 0 },
	hunter: { movement: 1, attack: 1, defense: 0, maxHp: 0, ap: 0 },
	scout: { movement: 2, attack: 0, defense: 0, maxHp: 0, ap: 0 },
	mage: { movement: 0, attack: 1, defense: 0, maxHp: 0, ap: 0 },
	summoner: { movement: 0, attack: 0, defense: 0, maxHp: 0, ap: 1 },
};

/* Character creation PT budget */
export const CHAR_POINT_BUDGET = 12;

/**
 * Cost per + 1 of each stat. HP is priced per + 3 hp
 * AP creation has no cost as it's not purchasable at creation
 */
export const STAT_POINT_COST: Record<keyof StatAllocation, number> = {
	movement: 3,
	attack: 1,
	defense: 2,
	hp: 1,
};

/* Sum the point cost of a given allowcation so we can enforce 12 budget */
export function totalPointsSpent(allocation: StatAllocation): number {
	return (
		allocation.movement * STAT_POINT_COST.movement +
		allocation.attack * STAT_POINT_COST.attack +
		allocation.defense * STAT_POINT_COST.defense +
		allocation.hp * STAT_POINT_COST.hp
	);
}

/* Compute final stats */
export function computeCharacterStats(
	characterClass: CharacterClass,
	pointsSpent: StatAllocation,
): MercenaryStats {
	const mod = CLASS_MODIFIERS[characterClass];

	return {
		movement: UNIVERSAL_BASE.movement + mod.movement + pointsSpent.movement,
		attack: UNIVERSAL_BASE.attack + mod.attack + pointsSpent.attack,
		defense: UNIVERSAL_BASE.defense + mod.defense + pointsSpent.defense,
		maxHp: UNIVERSAL_BASE.maxHp + mod.maxHp + pointsSpent.hp * 3,
		ap: UNIVERSAL_BASE.ap + mod.ap,
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
		id: crypto.randomUUID(),
		name,
		characterClass,
		modelIndex,
		pointsSpent,
		stats: computeCharacterStats(characterClass, pointsSpent),
		createdAt: Date.now(),
	};
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
