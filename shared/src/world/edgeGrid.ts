import type { GridCoord } from "./grid";

/**
 * A barrier on the edge between two adjacent cells — the direct
 * edge-based equivalent of the wall-type tile codes already used
 * elsewhere (low wall, full wall, fence, glass, door), just moved
 * from "a property of a cell" to "a property of the boundary between
 * two cells." None means the two cells are simply open to each other.
 */
export enum EdgeBarrier {
	None = 0,
	LowWall = 1,
	FullWall = 2,
	Fence = 3,
	Glass = 4,
	Door = 5,
}

/**
 * Per-cell edge storage for a width x height grid. Only north and
 * west edges are stored — a cell's south edge is its southern
 * neighbor's north edge, and its east edge is its eastern neighbor's
 * west edge, so storing all four per cell would double-store every
 * interior boundary. `north[y][x]` is the edge between (x,y) and
 * (x,y-1); `west[y][x]` is the edge between (x,y) and (x-1,y). Edges
 * along the outer boundary of the grid (e.g. north edges in row 0)
 * exist in the arrays but have no "outside" cell on the other side —
 * they're simply never queried by getEdgeBetween, since that always
 * takes two in-bounds coords.
 */
export interface EdgeGrid {
	width: number;
	height: number;
	north: EdgeBarrier[][];
	west: EdgeBarrier[][];
	/**
	 * Whether the wall on each edge can eventually be destroyed —
	 * stored as a parallel grid rather than folded into EdgeBarrier
	 * itself, so every piece of code that already reads barrier types
	 * is completely unaffected by this existing. Purely a flag for now:
	 * nothing currently reads it or implements actual destruction —
	 * that's future work (an ability/class that can break down walls),
	 * this just makes sure the data is there to support it later
	 * without another migration.
	 */
	destructibleNorth: boolean[][];
	destructibleWest: boolean[][];
}

export function createEmptyEdgeGrid(width: number, height: number): EdgeGrid {
	const north: EdgeBarrier[][] = [];
	const west: EdgeBarrier[][] = [];
	const destructibleNorth: boolean[][] = [];
	const destructibleWest: boolean[][] = [];
	for (let y = 0; y < height; y++) {
		north.push(new Array(width).fill(EdgeBarrier.None));
		west.push(new Array(width).fill(EdgeBarrier.None));
		destructibleNorth.push(new Array(width).fill(false));
		destructibleWest.push(new Array(width).fill(false));
	}
	return { width, height, north, west, destructibleNorth, destructibleWest };
}

/**
 * Gets the barrier on the shared boundary between two cardinally
 * adjacent cells, regardless of which one is "first." Returns
 * EdgeBarrier.None for non-adjacent coords rather than throwing —
 * callers that need to distinguish "no barrier" from "not actually
 * adjacent" should check isAdjacent themselves first; this function's
 * job is just the edge lookup.
 */
export function getEdgeBetween(
	edges: EdgeGrid,
	a: GridCoord,
	b: GridCoord,
): EdgeBarrier {
	if (a.y === b.y && Math.abs(a.x - b.x) === 1) {
		const rightCoord = a.x < b.x ? b : a; // the one with the larger x owns this as its west edge
		return edges.west[rightCoord.y]?.[rightCoord.x] ?? EdgeBarrier.None;
	}
	if (a.x === b.x && Math.abs(a.y - b.y) === 1) {
		const lowerCoord = a.y < b.y ? b : a; // the one with the larger y owns this as its north edge
		return edges.north[lowerCoord.y]?.[lowerCoord.x] ?? EdgeBarrier.None;
	}
	return EdgeBarrier.None;
}

export function setEdgeBetween(
	edges: EdgeGrid,
	a: GridCoord,
	b: GridCoord,
	barrier: EdgeBarrier,
): void {
	if (a.y === b.y && Math.abs(a.x - b.x) === 1) {
		const rightCoord = a.x < b.x ? b : a;
		if (edges.west[rightCoord.y])
			edges.west[rightCoord.y][rightCoord.x] = barrier;
		return;
	}
	if (a.x === b.x && Math.abs(a.y - b.y) === 1) {
		const lowerCoord = a.y < b.y ? b : a;
		if (edges.north[lowerCoord.y])
			edges.north[lowerCoord.y][lowerCoord.x] = barrier;
	}
}

/** Whether the wall on this edge is flagged as destructible. False for non-adjacent coords, same convention as getEdgeBetween. */
export function isEdgeDestructible(
	edges: EdgeGrid,
	a: GridCoord,
	b: GridCoord,
): boolean {
	if (a.y === b.y && Math.abs(a.x - b.x) === 1) {
		const rightCoord = a.x < b.x ? b : a;
		return edges.destructibleWest[rightCoord.y]?.[rightCoord.x] ?? false;
	}
	if (a.x === b.x && Math.abs(a.y - b.y) === 1) {
		const lowerCoord = a.y < b.y ? b : a;
		return edges.destructibleNorth[lowerCoord.y]?.[lowerCoord.x] ?? false;
	}
	return false;
}

export function setEdgeDestructible(
	edges: EdgeGrid,
	a: GridCoord,
	b: GridCoord,
	destructible: boolean,
): void {
	if (a.y === b.y && Math.abs(a.x - b.x) === 1) {
		const rightCoord = a.x < b.x ? b : a;
		if (edges.destructibleWest[rightCoord.y]) {
			edges.destructibleWest[rightCoord.y][rightCoord.x] = destructible;
		}
		return;
	}
	if (a.x === b.x && Math.abs(a.y - b.y) === 1) {
		const lowerCoord = a.y < b.y ? b : a;
		if (edges.destructibleNorth[lowerCoord.y]) {
			edges.destructibleNorth[lowerCoord.y][lowerCoord.x] = destructible;
		}
	}
}

/** Whether movement can cross this edge at all — full wall is the only hard block; everything else (including low wall) is passable, with low wall's extra cost being the pathfinder's concern, not this function's. */
export function edgeIsPassable(barrier: EdgeBarrier): boolean {
	return barrier !== EdgeBarrier.FullWall;
}

/** Whether this edge blocks line of sight — matches the existing per-tile elevation rule: full-height barriers block sight, except fence/glass, which are transparent by material regardless of height. Low wall is short enough to see over. */
export function edgeBlocksVision(barrier: EdgeBarrier): boolean {
	return barrier === EdgeBarrier.FullWall;
}

/** Extra movement points required to cross this edge, on top of the normal one-cell step — the same "low wall costs one extra to vault" rule from the elevation model, now living on the edge instead of a tile. */
export function edgeExtraMovementCost(barrier: EdgeBarrier): number {
	return barrier === EdgeBarrier.LowWall ? 1 : 0;
}
