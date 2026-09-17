import { Grid, TileType, type GridCoord } from "../grid";
import { EdgeBarrier, createEmptyEdgeGrid, setEdgeBetween, type EdgeGrid } from "../edgeGrid";

/**
 * Tile-level codes for the double-resolution format — deliberately a
 * much smaller set than the old single-grid scheme, since wall/fence/
 * glass/door all moved to being edge properties instead. What's left
 * here is genuinely just "what kind of ground is this," nothing about
 * barriers.
 */
export enum EdgeMapTileCode {
	Void = 0,
	Floor = 1,
	Pavement = 2,
	Nature = 3,
	River = 4,
	/**
	 * Purely decorative — marks the bottom landing of a staircase so
	 * it reads clearly on screen. Carries no cross-floor matching
	 * requirement at all; the actual floor-switch trigger is
	 * StairConnector, which can sit anywhere along the run between
	 * this and StairTop (including around a corner - see StairStep).
	 */
	StairBottom = 5,
	/** Purely decorative — the top landing, same idea as StairBottom. */
	StairTop = 6,
	/**
	 * Same connecting relationship as the old StairBottom, for a
	 * ladder instead of a staircase. Deliberately just the one tile -
	 * unlike a staircase, a ladder needs no path tiles or separate
	 * trigger point; the climb is a single, direct connection.
	 */
	LadderBottom = 7,
	/** Same connecting relationship as LadderBottom's match, for a ladder. */
	LadderTop = 8,
	/**
	 * A walkable step along a staircase's run, connecting a
	 * StairBottom to a StairTop (or to a StairConnector). Purely
	 * decorative and freely placeable - a run of these can corner,
	 * switchback, wind however the map needs, since nothing about
	 * validation depends on their shape or position.
	 */
	StairStep = 9,
	/**
	 * The actual floor-switch trigger for a staircase - unlike
	 * StairBottom/StairTop, THIS is what validateMapBundle checks:
	 * every StairConnector needs a matching StairConnector at the
	 * identical (x, y) on exactly one neighboring floor (the floor
	 * below if this is the "lower" copy of the pair, above if this is
	 * the "upper" copy - see compileMapBundle's elevation pass, which
	 * uses this same lower/upper distinction to render the two copies
	 * at different heights so the transition reads as one continuous
	 * rise across the instant floor-switch).
	 *
	 * Deliberately decoupled from StairBottom/StairTop's positions -
	 * this can sit anywhere along a winding or cornering run of
	 * StairStep tiles, not necessarily at the midpoint of a straight
	 * line between the two landings.
	 */
	StairConnector = 10,
}

const TILE_ELEVATION: Record<EdgeMapTileCode, number> = {
	[EdgeMapTileCode.Void]: Infinity,
	[EdgeMapTileCode.Floor]: 0,
	[EdgeMapTileCode.Pavement]: 0.1,
	[EdgeMapTileCode.Nature]: 0,
	[EdgeMapTileCode.River]: Infinity,
	[EdgeMapTileCode.StairBottom]: 0,
	[EdgeMapTileCode.StairTop]: 0,
	[EdgeMapTileCode.LadderBottom]: 0,
	[EdgeMapTileCode.LadderTop]: 0,
	[EdgeMapTileCode.StairStep]: 0,
	// Default for a single-floor compile with no cross-floor context -
	// the "lower half of the pair" value. compileMapBundle's elevation
	// pass overrides this to -0.5 for whichever copy of a matched pair
	// turns out to be the upper floor - see StairConnector's own doc
	// comment in the enum above.
	[EdgeMapTileCode.StairConnector]: 0.5,
};

export interface CompiledEdgeMap {
	grid: Grid;
	edges: EdgeGrid;
	elevation: Map<string, number>;
}

/**
 * Compiles a double-resolution blueprint into a Grid + EdgeGrid pair.
 * Blueprint dimensions must be (2*width-1) x (2*height-1) for some
 * logical width/height — odd row/column count is what makes "every
 * even index is a tile, every odd index is an edge" work out evenly
 * at the far boundary.
 */
export function compileEdgeMap(blueprint: number[][]): CompiledEdgeMap {
	const blueprintHeight = blueprint.length;
	const blueprintWidth = blueprint[0]?.length ?? 0;
	const width = (blueprintWidth + 1) / 2;
	const height = (blueprintHeight + 1) / 2;

	if (!Number.isInteger(width) || !Number.isInteger(height)) {
		throw new Error(
			`compileEdgeMap: blueprint dimensions (${blueprintWidth}x${blueprintHeight}) are not valid double-resolution dimensions — expected (2*W-1) x (2*H-1) for integer W, H.`,
		);
	}

	const grid = new Grid(width, height, TileType.Floor);
	const edges = createEmptyEdgeGrid(width, height);
	const elevation = new Map<string, number>();

	// Tile centers: every (2x, 2y) position.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const code = blueprint[2 * y][2 * x] as EdgeMapTileCode;
			const coord: GridCoord = { x, y };
			const elev = TILE_ELEVATION[code];
			grid.setTileType(
				coord,
				elev < Infinity ? TileType.Floor : TileType.Wall,
			);
			elevation.set(`${x},${y}`, elev);
		}
	}

	// Vertical edges (between (x,y) and (x+1,y)): odd column, even row.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width - 1; x++) {
			const code = blueprint[2 * y][2 * x + 1] as EdgeBarrier;
			setEdgeBetween(edges, { x, y }, { x: x + 1, y }, code);
		}
	}

	// Horizontal edges (between (x,y) and (x,y+1)): even column, odd row.
	for (let y = 0; y < height - 1; y++) {
		for (let x = 0; x < width; x++) {
			const code = blueprint[2 * y + 1][2 * x] as EdgeBarrier;
			setEdgeBetween(edges, { x, y }, { x, y: y + 1 }, code);
		}
	}

	// Odd,odd "corner" positions are unused (no diagonal walls) — not
	// read at all, but worth a cheap sanity check during development
	// so a stray non-zero value in a corner cell doesn't silently do
	// nothing and confuse whoever drew it.
	for (let y = 0; y < height - 1; y++) {
		for (let x = 0; x < width - 1; x++) {
			const cornerValue = blueprint[2 * y + 1][2 * x + 1];
			if (cornerValue !== 0) {
				throw new Error(
					`compileEdgeMap: corner position (${2 * x + 1},${2 * y + 1}) has non-zero value ${cornerValue} — diagonal walls aren't supported, this position must always be 0.`,
				);
			}
		}
	}

	return { grid, edges, elevation };
}
