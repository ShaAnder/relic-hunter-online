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
	/**
	 * General item slots (max 6, per `11-item-inventory-win-design.md`).
	 * Gear (weapon/armor/accessory) isn't tracked here yet — no gear items
	 * exist in the pool, those 3 slots are currently UI-only placeholders.
	 */
	items: ItemData[];
	/**
	 * Cards currently held, max 5. There is no personal deck field here —
	 * every mercenary draws from the ONE shared match deck
	 * (`GameSession.sharedDeck`, built once via `buildSharedDeck()`), not
	 * from a deck of their own. Only the hand — what's actually in a given
	 * mercenary's grasp right now — is personal state.
	 */
	hand: CardData[];
}

// Create fresh hunter at full HP, given starting position
export function createMercenary(
	id: string,
	coord: GridCoord,
	stats: MercenaryStats,
): MercenaryState {
	return { id, coord, stats, currentHp: stats.maxHp, items: [], hand: [] };
}
