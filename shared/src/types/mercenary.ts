import type { GridCoord } from "../world/grid";
import type {
	EntityCore,
	HasHand,
	HasItems,
	HasCharacterClass,
	HasName,
} from "./entity";

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

/** A hunter's live state during a match */
export type MercenaryState = EntityCore &
	HasHand &
	HasItems &
	HasCharacterClass &
	HasName;

export function createMercenary(
	id: string,
	coord: GridCoord,
	stats: MercenaryStats,
	characterClass: CharacterClass = "brawler",
	name: string = "Hunter",
): MercenaryState {
	return {
		id,
		coord,
		stats,
		characterClass,
		name,
		currentHp: stats.maxHp,
		hpCeiling: stats.maxHp,
		items: new Array(6).fill(null),
		hand: [],
	};
}
