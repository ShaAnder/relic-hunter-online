import type { Grid, GridCoord } from "../world/grid";
import { tilesBetween } from "./targeting";

export interface ZoneOwner {
	id: string;
	coord: GridCoord;
	zocRadius: number;
}

export interface ZoneCrossing {
	owner: ZoneOwner;
	pathIndex: number;
}

/**
 * True if `owner`'s zone genuinely reaches `tile` — within radius AND an
 * unbroken line to it. A wall between them blocks the zone entirely, same
 * physical reasoning as line-of-sight for ranged attacks: you can't
 * threaten a tile you can't actually reach around a wall.
 */
function zoneReaches(grid: Grid, owner: ZoneOwner, tile: GridCoord): boolean {
	const dist =
		Math.abs(tile.x - owner.coord.x) + Math.abs(tile.y - owner.coord.y);
	if (dist === 0 || dist > owner.zocRadius) return false;

	const between = tilesBetween(owner.coord, tile);
	return between.every((t) => grid.isWalkable(t));
}

/**
 * Every distinct ZoC owner a path crosses — deduped by id, so a move
 * charges one reaction strike per enemy zone entered, not per tile
 * inside it, and re-crossing the same owner's zone twice in one path
 * doesn't double-charge them. A zone blocked by a wall doesn't count as
 * crossed at all.
 */
export function findZonesCrossed(
	grid: Grid,
	path: GridCoord[],
	owners: ZoneOwner[],
): ZoneCrossing[] {
	const crossed = new Map<string, ZoneCrossing>();
	path.forEach((tile, index) => {
		for (const owner of owners) {
			if (crossed.has(owner.id)) continue;
			if (zoneReaches(grid, owner, tile)) {
				crossed.set(owner.id, { owner, pathIndex: index });
			}
		}
	});
	return Array.from(crossed.values()).sort((a, b) => a.pathIndex - b.pathIndex);
}
