import { Grid, TileType, type GridCoord, coordKey } from "../grid";

/** The numeric codes used in alleyways map blueprints — see ALLEYWAYS_MAP_BLUEPRINT's own doc comment for the authoritative list this must stay in sync with. */
export enum AlleywaysMapCode {
	Void = 0,
	Floor = 1,
	Pavement = 2,
	LowWall = 3,
	Fence = 4,
	Door = 5,
	Connector = 6,
	Nature = 7,
	Interactable = 8,
	River = 9,
	Bridge = 10,
	Balcony = 11,
	Runway = 12,
	FullWall = 13,
	Stairs = 14,
	Glass = 15,
}

/**
 * Base elevation per code, in character-height terms — see
 * elevation-rules.md for the full rationale. Void and River aren't
 * really "elevation" in the height sense (they're simply never
 * walkable at all), but are given a value here so every code has one
 * and callers don't need a separate special case just to look one up.
 */
const BASE_ELEVATION: Record<AlleywaysMapCode, number> = {
	[AlleywaysMapCode.Void]: Infinity,
	[AlleywaysMapCode.Floor]: 0,
	[AlleywaysMapCode.Pavement]: 0.1,
	[AlleywaysMapCode.LowWall]: 0.5,
	[AlleywaysMapCode.Fence]: 1,
	[AlleywaysMapCode.Door]: 0,
	[AlleywaysMapCode.Connector]: 0,
	[AlleywaysMapCode.Nature]: 0,
	[AlleywaysMapCode.Interactable]: 0,
	[AlleywaysMapCode.River]: Infinity,
	[AlleywaysMapCode.Bridge]: 0,
	[AlleywaysMapCode.Balcony]: 0,
	[AlleywaysMapCode.Runway]: 0,
	[AlleywaysMapCode.FullWall]: 1,
	[AlleywaysMapCode.Stairs]: 0,
	[AlleywaysMapCode.Glass]: 1,
};

/**
 * Which codes are transparent regardless of their own elevation.
 * Ordinary visibility follows elevation directly (below 1.0 = you can
 * see over it, 1.0+ = it blocks sight) — Fence and Glass are the
 * deliberate exceptions: both sit at full elevation (impassable, same
 * as a plain wall) while staying see-through by material rather than
 * by height. This is why transparency is tracked as its own flag
 * instead of purely derived from the elevation number.
 */
const ALWAYS_TRANSPARENT = new Set<AlleywaysMapCode>([
	AlleywaysMapCode.Fence,
	AlleywaysMapCode.Glass,
]);

/** Codes that are always walkable regardless of their own elevation value — doors, stairs, and bridges are explicitly designed as passages, not obstacles, so the elevation-based blocking rule never applies to them. */
const ALWAYS_WALKABLE = new Set<AlleywaysMapCode>([
	AlleywaysMapCode.Door,
	AlleywaysMapCode.Stairs,
	AlleywaysMapCode.Bridge,
]);

export interface CompiledAlleywaysMap {
	grid: Grid;
	/** Per-tile elevation, keyed by coordKey — includes the pavement-adjacency propagation into building interiors, so this is the actual elevation to use, not just the base per-code value. */
	elevation: Map<string, number>;
	/** Per-tile transparency (does this tile block line of sight), keyed by coordKey. */
	transparent: Map<string, boolean>;
	doorTiles: GridCoord[];
	stairsTiles: GridCoord[];
	interactableTiles: GridCoord[];
	natureTiles: GridCoord[];
	riverTiles: GridCoord[];
	bridgeTiles: GridCoord[];
	connectorTiles: GridCoord[];
	fenceTiles: GridCoord[];
	glassTiles: GridCoord[];
	lowWallTiles: GridCoord[];
	balconyTiles: GridCoord[];
	runwayTiles: GridCoord[];
}

/**
 * Compiles an alleyways map blueprint into a real Grid plus a full
 * per-tile elevation/transparency model and a coordinate list for
 * every feature code. Walkability follows elevation directly except
 * for the always-walkable passage codes (door/stairs/bridge).
 *
 * Movement *cost* for the 0.5-0.9 elevation tier (the "costs one
 * extra point to vault over" rule) is exposed here as elevation data
 * only — it is deliberately not wired into computeMovementRange
 * itself in this pass. That function is a uniform-cost BFS used by
 * both player movement and AI pathfinding; adding per-tile cost means
 * converting it to a weighted search, which is core, widely-used
 * logic that deserves its own focused, tested change rather than
 * being folded into a map-authoring pass.
 */
export function compileAlleywaysMap(
	blueprint: number[][],
): CompiledAlleywaysMap {
	const height = blueprint.length;
	const width = blueprint[0]?.length ?? 0;
	const grid = new Grid(width, height, TileType.Wall);

	const elevation = new Map<string, number>();
	const transparent = new Map<string, boolean>();

	const doorTiles: GridCoord[] = [];
	const stairsTiles: GridCoord[] = [];
	const interactableTiles: GridCoord[] = [];
	const natureTiles: GridCoord[] = [];
	const riverTiles: GridCoord[] = [];
	const bridgeTiles: GridCoord[] = [];
	const connectorTiles: GridCoord[] = [];
	const fenceTiles: GridCoord[] = [];
	const glassTiles: GridCoord[] = [];
	const lowWallTiles: GridCoord[] = [];
	const balconyTiles: GridCoord[] = [];
	const runwayTiles: GridCoord[] = [];

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const code = blueprint[y][x] as AlleywaysMapCode;
			const coord = { x, y };
			const key = coordKey(coord);
			const baseElev = BASE_ELEVATION[code];

			const walkable = ALWAYS_WALKABLE.has(code) || baseElev < 1;
			grid.setTileType(coord, walkable ? TileType.Floor : TileType.Wall);

			elevation.set(key, baseElev);
			transparent.set(key, ALWAYS_TRANSPARENT.has(code) || baseElev < 1);

			switch (code) {
				case AlleywaysMapCode.Door:
					doorTiles.push(coord);
					break;
				case AlleywaysMapCode.Stairs:
					stairsTiles.push(coord);
					break;
				case AlleywaysMapCode.Interactable:
					interactableTiles.push(coord);
					break;
				case AlleywaysMapCode.Nature:
					natureTiles.push(coord);
					break;
				case AlleywaysMapCode.River:
					riverTiles.push(coord);
					break;
				case AlleywaysMapCode.Bridge:
					bridgeTiles.push(coord);
					break;
				case AlleywaysMapCode.Connector:
					connectorTiles.push(coord);
					break;
				case AlleywaysMapCode.Fence:
					fenceTiles.push(coord);
					break;
				case AlleywaysMapCode.Glass:
					glassTiles.push(coord);
					break;
				case AlleywaysMapCode.LowWall:
					lowWallTiles.push(coord);
					break;
				case AlleywaysMapCode.Balcony:
					balconyTiles.push(coord);
					break;
				case AlleywaysMapCode.Runway:
					runwayTiles.push(coord);
					break;
			}
		}
	}

	applyGroundElevation(blueprint, width, height, elevation);

	return {
		grid,
		elevation,
		transparent,
		doorTiles,
		stairsTiles,
		interactableTiles,
		natureTiles,
		riverTiles,
		bridgeTiles,
		connectorTiles,
		fenceTiles,
		glassTiles,
		lowWallTiles,
		balconyTiles,
		runwayTiles,
	};
}

/**
 * Builds the actual elevation for every tile, on top of each code's
 * own base value — the additive model requested: any tile that isn't
 * plain open-street Floor is treated as sitting on raised ground
 * (0.1, "one pavement tile" — building interiors are drawn and
 * sampled directly as Pavement in the blueprint, so this needs no
 * building-detection logic at all), and anything with its own extra
 * height (a low wall, say) adds that height on top of whatever ground
 * it's standing on, rather than replacing it. A low wall against a
 * building interior reads as 0.1 + 0.5 = 0.6; the same wall out on
 * the open street stays 0 + 0.5 = 0.5.
 */
function applyGroundElevation(
	blueprint: number[][],
	width: number,
	height: number,
	elevation: Map<string, number>,
): void {
	// Every coordinate whose own ground is raised to 0.1 — every drawn
	// Pavement tile, which (per the blueprint's own doc comment)
	// already includes building interiors directly, not inferred via
	// any building-detection heuristic.
	const raisedGround = new Set<string>();
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (blueprint[y][x] === AlleywaysMapCode.Pavement) {
				raisedGround.add(`${x},${y}`);
			}
		}
	}

	// Anything else adjacent to raised ground (walls, doors, fences —
	// anything that isn't Floor or Pavement, both already handled)
	// adds its own base height on top of that ground rather than
	// replacing it.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const code = blueprint[y][x] as AlleywaysMapCode;
			if (
				code === AlleywaysMapCode.Floor ||
				code === AlleywaysMapCode.Pavement
			) {
				continue;
			}
			let adjacentToRaisedGround = false;
			for (const [dx, dy] of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			]) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
				if (raisedGround.has(`${nx},${ny}`)) {
					adjacentToRaisedGround = true;
					break;
				}
			}
			if (!adjacentToRaisedGround) continue;

			const key = coordKey({ x, y });
			const current = elevation.get(key) ?? BASE_ELEVATION[code];
			if (current === Infinity) continue; // Void/River never elevate
			elevation.set(key, current + BASE_ELEVATION[AlleywaysMapCode.Pavement]);
		}
	}
}
