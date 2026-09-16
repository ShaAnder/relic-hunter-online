import type { GridCoord } from "./grid";
import type { Grid } from "./grid";
import { coordKey } from "./grid";
import type { EdgeGrid } from "./edgeGrid";
import { getEdgeBetween, edgeBlocksVision } from "./edgeGrid";

/** How far unit can see around itself in tiles */
export const FOG_SIGHT_RANGE = 6;

/**
 * How many turns an explored but currently out of range tile stays dimly
 * visible before re-fogging to fully unseen
 */
export const FOG_DECAY_TURNS = 5;

export type TileVisibility = "unseen" | "explored" | "visible";

/**
 * Per unit fog memory. exploredTiles is "last turn seen" for decay
 * purposes. currentlyVisible is a separate, ephemeral record of
 * exactly which tiles are in range right now — cleared and rebuilt
 * every single time updateFogOfWar runs, not just once per turn. This
 * split exists specifically so a tile a unit walks away from mid-move
 * drops out of "visible" the instant it's actually out of range,
 * rather than staying visible for the rest of that same turn just
 * because the turn number hasn't changed yet.
 */
export interface HasFogOfWar {
	exploredTiles: Record<string, number>;
	currentlyVisible: Record<string, true>;
}

export function createFogOfWar(): HasFogOfWar {
	return { exploredTiles: {}, currentlyVisible: {} };
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
 * Walks a straight line from `from` toward `to` (Bresenham), stopping
 * the instant it crosses a vision-blocking barrier before reaching the
 * destination. The destination tile itself is never checked as a cell
 * wall — you can see a wall, just not through it.
 *
 * When `edges` is provided (EdgeGrid maps), vision is blocked by
 * edgeBlocksVision on the edge between consecutive cells along the ray.
 * When `edges` is omitted, behavior is unchanged: grid.blocksVision on
 * intermediate cells.
 */
function hasClearLineOfSight(
	grid: Grid,
	from: GridCoord,
	to: GridCoord,
	edges?: EdgeGrid | null,
): boolean {
	let x0 = from.x;
	let y0 = from.y;
	const x1 = to.x;
	const y1 = to.y;
	const dx = Math.abs(x1 - x0);
	const dy = Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx - dy;

	while (x0 !== x1 || y0 !== y1) {
		const prev = { x: x0, y: y0 };
		const e2 = 2 * err;
		const stepsX = e2 > -dy;
		const stepsY = e2 < dx;
		if (stepsX) {
			err -= dy;
			x0 += sx;
		}
		if (stepsY) {
			err += dx;
			y0 += sy;
		}
		const reachedDestination = x0 === x1 && y0 === y1;
		if (edges) {
			if (stepsX && stepsY) {
				// A genuinely diagonal step — getEdgeBetween only
				// understands orthogonally-adjacent cells, so it can't
				// answer "is there a wall on this diagonal" directly.
				// The sightline passes exactly through the point where
				// four cells meet (prev, the two orthogonal
				// "in-between" cells, and the destination), so all
				// four edges bordering that corner need checking — a
				// wall on any one of them means solid matter sits
				// right at the corner the sightline is trying to cut
				// through. This is the standard "no seeing/moving
				// diagonally past a wall corner" rule.
				const horizontalNeighbor = { x: x0, y: prev.y };
				const verticalNeighbor = { x: prev.x, y: y0 };
				const dest = { x: x0, y: y0 };
				if (
					edgeBlocksVision(getEdgeBetween(edges, prev, horizontalNeighbor)) ||
					edgeBlocksVision(getEdgeBetween(edges, prev, verticalNeighbor)) ||
					edgeBlocksVision(getEdgeBetween(edges, horizontalNeighbor, dest)) ||
					edgeBlocksVision(getEdgeBetween(edges, verticalNeighbor, dest))
				) {
					return false;
				}
			} else if (
				edgeBlocksVision(getEdgeBetween(edges, prev, { x: x0, y: y0 }))
			) {
				return false;
			}
		} else if (!reachedDestination && grid.blocksVision({ x: x0, y: y0 })) {
			return false;
		}
	}
	return true;
}

/**
 * Marks every tile within sight range that ALSO has a clear line of
 * sight from center as explored (for decay tracking) and rebuilds
 * currentlyVisible from scratch to exactly that set.
 *
 * Pass `edges` for edge-based maps so full walls on edges block vision.
 * Omit `edges` for legacy cell-wall maps (unchanged behavior).
 */
export function updateFogOfWar(
	fog: HasFogOfWar,
	center: GridCoord,
	currentTurn: number,
	grid: Grid,
	range: number = FOG_SIGHT_RANGE,
	edges?: EdgeGrid | null,
): void {
	fog.currentlyVisible = {};
	for (const coord of tilesInSightRange(center, range)) {
		if (!grid.getTile(coord)) continue;
		if (!hasClearLineOfSight(grid, center, coord, edges)) continue;
		const key = coordKey(coord);
		fog.exploredTiles[key] = currentTurn;
		fog.currentlyVisible[key] = true;
	}
}

/**
 * Read for each type of tile. `center`, `currentTurn`, and `range` are
 * kept in the signature only for call-site compatibility and for the
 * decay check below — "visible" itself is now purely membership in
 * currentlyVisible, which updateFogOfWar rebuilds fresh every call.
 */
export function getTileVisibility(
	fog: HasFogOfWar,
	coord: GridCoord,
	_center: GridCoord,
	currentTurn: number,
	_range: number = FOG_SIGHT_RANGE,
	decayTurns: number = FOG_DECAY_TURNS,
): TileVisibility {
	const key = coordKey(coord);
	if (fog.currentlyVisible[key]) return "visible";

	const lastSeen = fog.exploredTiles[key];
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

/**
 * Nearest walkable tile this unit hasn't seen at all yet (strictly
 * "unseen", not merely decayed-but-once-explored). Returns null only
 * when the entire map has already been seen by this unit.
 */
export function findNearestUnexploredTile(
	fog: HasFogOfWar,
	self: GridCoord,
	grid: Grid,
	currentTurn: number,
): GridCoord | null {
	let best: GridCoord | null = null;
	let bestDist = Infinity;
	for (let x = 0; x < grid.width; x++) {
		for (let y = 0; y < grid.height; y++) {
			const coord = { x, y };
			const tile = grid.getTile(coord);
			if (!tile || tile.type === "wall") continue;
			if (getTileVisibility(fog, coord, self, currentTurn) !== "unseen") {
				continue;
			}
			const dist = Math.abs(coord.x - self.x) + Math.abs(coord.y - self.y);
			if (dist < bestDist) {
				bestDist = dist;
				best = coord;
			}
		}
	}
	return best;
}

/**
 * Marks every tile in range of `center` as explored (for decay/memory
 * purposes only) — deliberately does NOT touch currentlyVisible.
 * Pass `edges` on edge maps so LOS matches updateFogOfWar.
 */
export function markAreaExplored(
	fog: HasFogOfWar,
	center: GridCoord,
	currentTurn: number,
	grid: Grid,
	range: number = FOG_SIGHT_RANGE,
	edges?: EdgeGrid | null,
): void {
	for (const coord of tilesInSightRange(center, range)) {
		if (!grid.getTile(coord)) continue;
		if (!hasClearLineOfSight(grid, center, coord, edges)) continue;
		fog.exploredTiles[coordKey(coord)] = currentTurn;
	}
}
