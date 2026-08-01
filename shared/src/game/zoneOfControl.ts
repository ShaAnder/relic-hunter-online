import type { GridCoord } from "./grid";

export interface ZoneOwner {
	id: string;
	coord: GridCoord;
	zocRadius: number;
}

/**
 * Every distinct ZoC owner a path crosses — deduped by id, so a move
 * charges one reaction strike per enemy zone entered, not per tile
 * inside it, and re-crossing the same owner's zone twice in one path
 * doesn't double-charge them.
 */
export function findZonesCrossed(
	path: GridCoord[],
	owners: ZoneOwner[],
): ZoneOwner[] {
	const crossed = new Map<string, ZoneOwner>();
	for (const tile of path) {
		for (const owner of owners) {
			if (crossed.has(owner.id)) continue;
			const dist =
				Math.abs(tile.x - owner.coord.x) + Math.abs(tile.y - owner.coord.y);
			if (dist > 0 && dist <= owner.zocRadius) {
				crossed.set(owner.id, owner);
			}
		}
	}
	return Array.from(crossed.values());
}
