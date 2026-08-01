import type { GridCoord } from "../game/grid";
import type { ItemData } from "../game/item";
import type { CardData } from "../game/card";

export type CharacterClass =
	| "tank"
	| "brawler"
	| "hunter"
	| "scout"
	| "mage"
	| "summoner";

/**
 * A char permanent stats - set at char creation, changes via level up,
 * unchanged during a match for now we will use spd/atk/def/hp
 */
export interface MercenaryStats {
	movement: number;
	attack: number;
	defense: number;
	maxHp: number;
	ap: number;
}

// mercenaries live state during a map
export interface MercenaryState {
	id: string;
	coord: GridCoord;
	stats: MercenaryStats;
	characterClass: CharacterClass;
	currentHp: number;
	hpCeiling: number;
	items: (ItemData | null)[];
	hand: CardData[];
}

export function createMercenary(
	id: string,
	coord: GridCoord,
	stats: MercenaryStats,
	characterClass: CharacterClass = "brawler",
): MercenaryState {
	return {
		id,
		coord,
		stats,
		characterClass,
		currentHp: stats.maxHp,
		hpCeiling: stats.maxHp,
		items: new Array(6).fill(null),
		hand: [],
	};
}
