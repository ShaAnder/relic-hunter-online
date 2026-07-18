import { Grid, coordKey, type GridCoord } from "./grid";

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
): Map<string, MovementRangeEntry> {
	const range = new Map<string, MovementRangeEntry>();
	range.set(coordKey(start), { coord: start, distance: 0, cameFrom: null });

	// create our frontier arr (tiles we're currently checking)
	// and push our start into it
	let frontier: GridCoord[] = [start];

	// loop over our movement budget, for each iteration run loop
	for (let step = 1; step <= movementBudget; step++) {
		// set arr for all coords we can move to
		const nextFrontier: GridCoord[] = [];

		// loop through each coord in frontier (start for now)
		for (const coord of frontier) {
			// loop through all the neighbours of the current frontier tile
			for (const neighbour of grid.getNeighbors(coord)) {
				// get the key of that coord
				const key = coordKey(neighbour);
				// if range has key already we've already reached
				if (range.has(key)) continue;
				if (!grid.isWalkable(neighbour)) continue;

				// put the coordinate into our range
				range.set(key, { coord: neighbour, distance: step, cameFrom: coord });
				nextFrontier.push(neighbour);
			}
		}
		frontier = nextFrontier;
		// nothing left to expand / no more movement
		if (frontier.length === 0) break;
	}

	return range;
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
 * Finds the reachable tile in `range` closest (straight-line) to `target` —
 * used to "clamp" a hovered tile that's outside the movement budget down to
 * the nearest tile the hunter can actually reach in that general direction.
 * Returns null only if range is empty (0 movement remaining).
 */
export function findNearestReachableTile(
	range: Map<string, MovementRangeEntry>,
	target: GridCoord,
): GridCoord | null {
	let closest: GridCoord | null = null;
	let closestDistSq = Infinity;

	for (const entry of range.values()) {
		const dx = entry.coord.x - target.x;
		const dy = entry.coord.y - target.y;
		const distSq = dx * dx + dy * dy;

		if (distSq < closestDistSq) {
			closestDistSq = distSq;
			closest = entry.coord;
		}
	}

	return closest;
}
