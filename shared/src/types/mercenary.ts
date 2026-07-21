import type { GridCoord } from "../game/grid";
import type { ItemData } from "../game/item";

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
	/**
	 * General item slots (max 6, per `11-item-inventory-win-design.md`).
	 * Gear (weapon/armor/accessory) isn't tracked here yet — no gear items
	 * exist in the pool, those 3 slots are currently UI-only placeholders.
	 */
	items: ItemData[];
}

// Create fresh hunter at full HP, given starting position
export function createMercenary(
	id: string,
	coord: GridCoord,
	stats: MercenaryStats,
): MercenaryState {
	return { id, coord, stats, currentHp: stats.maxHp, items: [] };
}
