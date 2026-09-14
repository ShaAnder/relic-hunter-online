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
}

const TILE_ELEVATION: Record<EdgeMapTileCode, number> = {
	[EdgeMapTileCode.Void]: Infinity,
	[EdgeMapTileCode.Floor]: 0,
	[EdgeMapTileCode.Pavement]: 0.1,
	[EdgeMapTileCode.Nature]: 0,
	[EdgeMapTileCode.River]: Infinity,
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
