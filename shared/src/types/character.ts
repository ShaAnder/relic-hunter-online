import type { MercenaryState, MercenaryStats } from "./mercenary";
import { createMercenary } from "./mercenary";

export type CharacterClass =
	| "tank"
	| "brawler"
	| "hunter"
	| "soout"
	| "mage"
	| "summoner";

/* Raw point allowcation chosen at creation - units of the stat not pts spent */
export interface StatAllocation {
	movement: number;
	attack: number;
	defense: number;
	hp: number;
	ap: number;
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
	knight: { movement: 0, attack: 0, defense: 3, maxHp: 15, ap: 0 },
	monk: { movement: 1, attack: 2, defense: 2, maxHp: 5, ap: 0 },
	: { movement: 2, attack: 1, defense: 0, maxHp: 10, ap: 0 },
	scout: { movement: 3, attack: 1, defense: 0, maxHp: 2, ap: 0 },
	mage: { movement: 1, attack: 2, defense: 0, maxHp: 0, ap: 0 },
	summoner: { movement: 1, attack: 0, defense: 0, maxHp: 0, ap: 1 },
};
