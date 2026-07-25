import type { GridCoord } from "../game/grid";
import type { ItemData } from "../game/item";
import type { CardData } from "../game/card";

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
	currentHp: number;
	/** Current effective max HP — normally equals stats.maxHp, but drops to a knockout ceiling after a defeat */
	hpCeiling: number;
	items: ItemData[];
	hand: CardData[];
}

// Create fresh hunter at full HP, given starting position
export function createMercenary(
	id: string,
	coord: GridCoord,
	stats: MercenaryStats,
): MercenaryState {
	return {
		id,
		coord,
		stats,
		currentHp: stats.maxHp,
		hpCeiling: stats.maxHp,
		items: [],
		hand: [],
	};
}
