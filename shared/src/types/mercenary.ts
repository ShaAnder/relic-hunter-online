import type { GridCoord } from "../game/grid";

/**
 * A char permanent stats - set at char creation, changes via level up,
 * unchanged during a match for now we will use spd/atk/def/hp
 */
export interface MercenaryStats {
	speed: number;
	attack: number;
	defense: number;
	maxHp: number;
}

// mercenaries live state during a map
export interface MercenaryState {
	id: string;
	coord: GridCoord;
	stats: MercenaryStats;
	currentHp: number;
}

// Create fresh hunter at full HP, given starting position
export function createMercenary(
	id: string,
	coord: GridCoord,
	stats: MercenaryStats,
): MercenaryState {
	return { id, coord, stats, currentHp: stats.maxHp };
}
