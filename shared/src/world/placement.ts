import { Grid, coordKey, GridCoord } from "./grid";

/**
 * Orthogonal (Manhattan) distance — the natural metric on a 4-connected grid.
 * @param a - first tile
 * @param b - second tile
 */
export function manhattanDistance(a: GridCoord, b: GridCoord): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Preferred minimum and fallback gaps */
export const CHEST_MIN_DIST = 7;
export const FALLBACK_DIST = 3;

/**
 * Picks a walkable tile at least `minDistance` from every coord already in
 * `used`. Degrades to `fallbackDistance`, then to any free walkable tile,
 * so placement only fails when the map has no free walkable cells left.
 * @param grid - match grid
 * @param used - tiles already reserved (spawn, prior chests, etc.)
 * @param minDistance - preferred minimum Manhattan gap
 * @param fallbackDistance - softer gap when preferred is impossible
 * @author ShaAnder
 */
export function pickSpreadWalkableTile(
	grid: Grid,
	used: Set<string>,
	minDistance: number = CHEST_MIN_DIST,
	fallbackDistance: number = FALLBACK_DIST,
): GridCoord | null {
	//set list of potential coordinates
	const candidates: GridCoord[] = [];
	// for each tile check if is walkable and not used
	for (let x = 0; x < grid.width; x++) {
		for (let y = 0; y < grid.height; y++) {
			const coord = { x, y };
			if (!grid.isWalkable(coord)) continue;
			if (used.has(coordKey(coord))) continue;
			// if it is viable push to candidates
			candidates.push(coord);
		}
	}
	// if no candidates return null
	if (candidates.length === 0) return null;

	// Take our used coord strings and map them into grid coords
	const usedCoords: GridCoord[] = [...used].map((k) => {
		const [x, y] = k.split(",").map(Number);
		return { x, y };
	});

	// check if current candidate is far enough from everything placed
	const meets = (c: GridCoord, min: number) =>
		usedCoords.every((u) => manhattanDistance(c, u) >= min);

	// Build our final pool of potential candidates
	const strict = candidates.filter((c) => meets(c, minDistance));
	const pool =
		strict.length > 0
			? strict
			: candidates.filter((c) => meets(c, fallbackDistance));
	const finalPool = pool.length > 0 ? pool : candidates;

	return finalPool[Math.floor(Math.random() * finalPool.length)];
}

/**
 * Chooses an Exit tile after the relic is found. Prefers tiles whose
 * Manhattan distance from `from` is at least `minFraction` of (width+height).
 * If none clear that floor, takes the farthest tier instead.
 * @param grid - match grid (no Exit tile exists yet)
 * @param from - coord where the relic was found
 * @param blocked - tiles that must not receive the Exit (units, find tile)
 * @param minFraction - fraction of map span used as the soft distance floor
 * @author ShaAnder
 */
export function pickExitFarFrom(
	grid: Grid,
	from: GridCoord,
	blocked: Set<string> = new Set(),
	minFraction: number = 0.35,
): GridCoord | null {
	// find max span of the map and use it + fraction to calculate min tile distance
	// for exit spawn candidates
	const maxSpan = grid.width + grid.height;
	const minDist = Math.max(1, Math.floor(maxSpan * minFraction));

	// set obj of potential candidates with their distance
	const candidates: { coord: GridCoord; dist: number }[] = [];
	// loop through to find viable candidates
	for (let x = 0; x < grid.width; x++) {
		for (let y = 0; y < grid.height; y++) {
			const coord = { x, y };
			if (!grid.isWalkable(coord)) continue;
			if (blocked.has(coordKey(coord))) continue;
			if (coord.x === from.x && coord.y === from.y) continue;
			candidates.push({ coord, dist: manhattanDistance(from, coord) });
		}
	}
	// if no viable candidates return null
	if (candidates.length === 0) return null;

	// check candidates that are far enough to be eligible
	const farEnough = candidates.filter((c) => c.dist >= minDist);
	// if no eligible candidates find best possible alternatives
	if (farEnough.length === 0) {
		const best = Math.max(...candidates.map((c) => c.dist));
		const top = candidates.filter((c) => c.dist === best);
		return top[Math.floor(Math.random() * top.length)].coord;
	}

	return farEnough[Math.floor(Math.random() * farEnough.length)].coord;
}
