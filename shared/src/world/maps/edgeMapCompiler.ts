import { Grid, TileType, type GridCoord } from "../grid";
import {
	EdgeBarrier,
	createEmptyEdgeGrid,
	setEdgeBetween,
	type EdgeGrid,
} from "../edgeGrid";
import {
	clampElevationStep,
	elevationHeightForStep,
	type ElevationStep,
} from "./elevation";

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
	 * Cross-floor staircase trigger.
	 *
	 * Matching this code at the same logical coordinate on a
	 * neighbouring floor enables the floor switch.
	 *
	 * Connector identity does not imply physical elevation - terrain
	 * height for a connector tile is authored independently, like
	 * every other walkable tile (see elevation.ts).
	 */
	StairConnector = 10,
	/**
	 * Roadway material.
	 *
	 * Appended rather than inserted so every existing saved numeric
	 * tile code keeps its meaning. Defaults to a lower elevation step
	 * than ordinary ground (see defaultElevationStepForTileCode) so an
	 * unmodified Road/Pavement boundary produces the intended curb
	 * relationship without needing to be manually authored.
	 */
	Road = 11,
}

/**
 * Material defaults only.
 *
 * Once a tile has an explicit authored elevation step, changing its
 * material does not change its height.
 *
 * Road defaults lower than ordinary ground so an unmodified
 * Road/Pavement boundary produces the intended curb relationship.
 */
export function defaultElevationStepForTileCode(
	code: EdgeMapTileCode,
): ElevationStep {
	switch (code) {
		case EdgeMapTileCode.Road:
			return -2;
		default:
			return 0;
	}
}

export function isWalkableEdgeTileCode(code: EdgeMapTileCode): boolean {
	switch (code) {
		case EdgeMapTileCode.Floor:
		case EdgeMapTileCode.Pavement:
		case EdgeMapTileCode.Nature:
		case EdgeMapTileCode.StairBottom:
		case EdgeMapTileCode.StairTop:
		case EdgeMapTileCode.LadderBottom:
		case EdgeMapTileCode.LadderTop:
		case EdgeMapTileCode.StairStep:
		case EdgeMapTileCode.StairConnector:
		case EdgeMapTileCode.Road:
			return true;
		case EdgeMapTileCode.Void:
		case EdgeMapTileCode.River:
		default:
			return false;
	}
}

export function isStairTraversalTileCode(
	code: EdgeMapTileCode | undefined,
): boolean {
	return (
		code === EdgeMapTileCode.StairBottom ||
		code === EdgeMapTileCode.StairTop ||
		code === EdgeMapTileCode.StairStep ||
		code === EdgeMapTileCode.StairConnector
	);
}

export interface CompiledEdgeMap {
	grid: Grid;
	edges: EdgeGrid;
	/** Material / structural identity. */
	tileCodes: Map<string, EdgeMapTileCode>;
	/** Integer authored elevation truth. */
	elevationSteps: Map<string, ElevationStep>;
	/** Resolved physical height used by rendering/entities. */
	elevation: Map<string, number>;
}

/**
 * Compiles a double-resolution blueprint into a Grid + EdgeGrid pair,
 * plus per-tile material identity and resolved elevation.
 * elevationOverrides is keyed by logical "x,y" and takes priority over
 * a tile code's material default (see defaultElevationStepForTileCode)
 * - this is how an authored map's explicit Raise/Lower painting
 * overrides what the material alone would produce.
 *
 * Blueprint dimensions must be (2*width-1) x (2*height-1) for some
 * logical width/height — odd row/column count is what makes "every
 * even index is a tile, every odd index is an edge" work out evenly
 * at the far boundary.
 */
export function compileEdgeMap(
	blueprint: number[][],
	elevationOverrides: Record<string, number> = {},
): CompiledEdgeMap {
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
	const tileCodes = new Map<string, EdgeMapTileCode>();
	const elevationSteps = new Map<string, ElevationStep>();
	const elevation = new Map<string, number>();

	// Tile centers: every (2x, 2y) position.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const code = blueprint[2 * y][2 * x] as EdgeMapTileCode;
			const coord: GridCoord = { x, y };
			const key = `${x},${y}`;
			const walkable = isWalkableEdgeTileCode(code);

			const override = elevationOverrides[key];
			const step = clampElevationStep(
				override === undefined
					? defaultElevationStepForTileCode(code)
					: override,
			);

			tileCodes.set(key, code);
			elevationSteps.set(key, step);

			grid.setTileType(coord, walkable ? TileType.Floor : TileType.Wall);

			elevation.set(key, walkable ? elevationHeightForStep(step) : Infinity);
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

	return { grid, edges, tileCodes, elevationSteps, elevation };
}
