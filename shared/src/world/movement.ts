import { Grid, coordKey, type GridCoord } from "./grid";
import { type EdgeGrid, getEdgeBetween, edgeIsPassable } from "./edgeGrid";

/**
 * Movement range computed - cost to reach and previous tile
 */
export interface MovementRangeEntry {
	coord: GridCoord;
	distance: number;
	cameFrom: GridCoord | null;
}

/**
 * Computes every tile reacable from starting pos within budget, relies on
 * Grid.getNeighbours so we can never move diagonal
 *
 * @param grid - grid map
 * @param start - starting pos
 * @param movementBudget - chars movement + card used
 *
 * @returns range of movement
 */
export function computeMovementRange(
	grid: Grid,
	start: GridCoord,
	movementBudget: number,
	blockedTiles?: Set<string>,
): Map<string, MovementRangeEntry> {
	const range = new Map<string, MovementRangeEntry>();
	range.set(coordKey(start), { coord: start, distance: 0, cameFrom: null });

	let frontier: GridCoord[] = [start];

	for (let step = 1; step <= movementBudget; step++) {
		const nextFrontier: GridCoord[] = [];

		for (const coord of frontier) {
			for (const neighbour of grid.getNeighbors(coord)) {
				const key = coordKey(neighbour);
				if (range.has(key)) continue;
				if (!grid.isWalkable(neighbour)) continue;
				if (blockedTiles?.has(key)) continue;

				range.set(key, { coord: neighbour, distance: step, cameFrom: coord });
				nextFrontier.push(neighbour);
			}
		}
		frontier = nextFrontier;
		if (frontier.length === 0) break;
	}

	return range;
}

/**
 * Same BFS as computeMovementRange, but for edge-based maps: a step
 * between two cells is blocked by checking the barrier on the edge
 * between them (edgeIsPassable), not by checking whether the
 * destination cell itself is a wall — every cell in an edge-based map
 * is walkable by definition, so cell-level walkability is
 * meaningless here. Deliberately still uniform-cost, same scoping
 * gap as the existing tile-based elevation model: a low wall edge
 * blocks nothing (it's passable) but doesn't yet cost the extra
 * movement point it's meant to — that's edgeExtraMovementCost's job,
 * not yet wired in, consistent with elevation's low-wall cost not
 * being wired into computeMovementRange either.
 */
export function computeMovementRangeWithEdges(
	grid: Grid,
	edges: EdgeGrid,
	start: GridCoord,
	movementBudget: number,
	blockedTiles?: Set<string>,
): Map<string, MovementRangeEntry> {
	const range = new Map<string, MovementRangeEntry>();
	range.set(coordKey(start), { coord: start, distance: 0, cameFrom: null });

	let frontier: GridCoord[] = [start];

	for (let step = 1; step <= movementBudget; step++) {
		const nextFrontier: GridCoord[] = [];

		for (const coord of frontier) {
			for (const neighbour of grid.getNeighbors(coord)) {
				const key = coordKey(neighbour);
				if (range.has(key)) continue;
				if (!grid.isWalkable(neighbour)) continue;
				if (!edgeIsPassable(getEdgeBetween(edges, coord, neighbour))) continue;
				if (blockedTiles?.has(key)) continue;

				range.set(key, { coord: neighbour, distance: step, cameFrom: coord });
				nextFrontier.push(neighbour);
			}
		}
		frontier = nextFrontier;
		if (frontier.length === 0) break;
	}

	return range;
}

/**
 * Single entry for map movement range: uses edges when present.
 */
export function computeMapMovementRange(
	grid: Grid,
	start: GridCoord,
	movementBudget: number,
	blockedTiles?: Set<string>,
	edges?: EdgeGrid | null,
): Map<string, MovementRangeEntry> {
	if (edges) {
		return computeMovementRangeWithEdges(
			grid,
			edges,
			start,
			movementBudget,
			blockedTiles,
		);
	}
	return computeMovementRange(grid, start, movementBudget, blockedTiles);
}

export function getPathTo(
	range: Map<string, MovementRangeEntry>,
	destination: GridCoord,
): GridCoord[] | null {
	// get our destination point
	const destEntry = range.get(coordKey(destination));
	if (!destEntry) return null;

	const path: GridCoord[] = [];
	let current: MovementRangeEntry | undefined = destEntry;

	while (current && current.cameFrom !== null) {
		path.push(current.coord);
		current = range.get(coordKey(current.cameFrom));
	}

	return path.reverse();
}

/**
 * Finds the reachable tile in `range` closest to `target` by REAL
 * walkable-path distance — not straight-line, which picks geometrically-
 * close dead-ends (pressed against a wall) over tiles that are further
 * "as the crow flies" but actually lead somewhere via a real route.
 * Runs a second BFS from `target` outward and scores every candidate in
 * `range` by that BFS's recorded distance. Costs one extra full-map BFS
 * per call — negligible for turn-based AI decisions, not a per-frame path.
 */
export function findNearestReachableTile(
	grid: Grid,
	range: Map<string, MovementRangeEntry>,
	target: GridCoord,
	blockedTiles?: Set<string>,
	edges?: EdgeGrid | null,
): GridCoord | null {
	if (range.size === 0) return null;

	const directKey = coordKey(target);
	if (range.has(directKey)) return target;

	const targetRange = computeMapMovementRange(
		grid,
		target,
		grid.width * grid.height,
		blockedTiles,
		edges,
	);

	let best: GridCoord | null = null;
	let bestDist = Infinity;

	for (const entry of range.values()) {
		const distFromTarget = targetRange.get(coordKey(entry.coord))?.distance;
		if (distFromTarget === undefined) continue;
		if (distFromTarget < bestDist) {
			bestDist = distFromTarget;
			best = entry.coord;
		}
	}

	return best;
}
