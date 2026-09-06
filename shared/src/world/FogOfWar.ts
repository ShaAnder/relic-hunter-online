import type { GridCoord } from "./grid";
import type { Grid } from "./grid";
import { coordKey } from "./grid";

/** How far unit can see around itself in tiles */
export const FOG_SIGHT_RANGE = 6;

/**
 * How many turns an explored but currently out of range tile stays dimly
 * visible before re-fogging to fully unseen
 */
export const FOG_DECAY_TURNS = 5;

export type TileVisibility = "unseen" | "explored" | "visible";

/**
 * Per unit fog memory
 */
export interface HasFogOfWar {
	exploredTiles: Record<string, number>;
}

export function createFogOfWar(): HasFogOfWar {
	return { exploredTiles: {} };
}

/** Every tile within FOG_SIGHT_RANGE of center, we use manhattan distance */
export function tilesInSightRange(
	center: GridCoord,
	range: number = FOG_SIGHT_RANGE,
): GridCoord[] {
	// set our tiles and loop over them
	const tiles: GridCoord[] = [];
	for (let dx = -range; dx <= range; dx++) {
		for (let dy = -range; dy <= range; dy++) {
			if (Math.abs(dx) + Math.abs(dy) > range) continue;
			tiles.push({ x: center.x + dx, y: center.y + dy });
		}
	}
	// return the tiles
	return tiles;
}

/**
 * Marks every tile within sight
 */
export function updateFogOFWar(
	fog: HasFogOfWar,
	center: GridCoord,
	currentTurn: number,
	grid: Grid,
	range: number = FOG_SIGHT_RANGE,
): void {
	for (const coord of tilesInSightRange(center, range)) {
		if (!grid.getTile(coord)) continue;
		fog.exploredTiles[coordKey(coord)] = currentTurn;
	}
}

/** Read for each type of tile */
export function getTileVisibility(
	fog: HasFogOfWar,
	coord: GridCoord,
	center: GridCoord,
	currentTurn: number,
	range: number = FOG_SIGHT_RANGE,
	decayTurns: number = FOG_DECAY_TURNS,
): TileVisibility {
	const distance = Math.abs(coord.x - center.x) + Math.abs(coord.y - center.y);
	if (distance <= range) return "visible";

	const lastSeen = fog.exploredTiles[coordKey(coord)];
	if (lastSeen === undefined) return "unseen";
	if (currentTurn - lastSeen >= decayTurns) return "unseen";

	return "explored";
}

/** Remove tiles that have decayed past FOG DECAY */
export function pruneDecayedTiles(fog: HasFogOfWar, currentTurn: number): void {
	for (const key in fog.exploredTiles) {
		if (currentTurn - fog.exploredTiles[key] >= FOG_DECAY_TURNS) {
			delete fog.exploredTiles[key];
		}
	}
}
