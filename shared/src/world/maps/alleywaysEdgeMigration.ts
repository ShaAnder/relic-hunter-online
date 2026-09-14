import { Grid, TileType, coordKey, type GridCoord } from "../grid";
import {
	EdgeBarrier,
	createEmptyEdgeGrid,
	getEdgeBetween,
	setEdgeBetween,
	type EdgeGrid,
} from "../edgeGrid";
import {
	EdgeMapTileCode,
	type CompiledEdgeMap,
} from "./edgeMapCompiler";

/**
 * Numeric codes used by the existing Alleyways blueprints.
 *
 * Kept here deliberately so the edge-map path no longer depends on
 * alleywaysMap.ts / compileAlleywaysMap(). Once the edge migration is
 * accepted, the old Alleyways compiler can be removed independently.
 */
enum LegacyAlleywaysCode {
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

const STRUCTURAL_CODES = new Set<LegacyAlleywaysCode>([
	LegacyAlleywaysCode.LowWall,
	LegacyAlleywaysCode.Fence,
	LegacyAlleywaysCode.Door,
	LegacyAlleywaysCode.FullWall,
	LegacyAlleywaysCode.Glass,
]);

const DIRECTIONS = [
	{ dx: 0, dy: -1, side: "N" },
	{ dx: 1, dy: 0, side: "E" },
	{ dx: 0, dy: 1, side: "S" },
	{ dx: -1, dy: 0, side: "W" },
] as const;

type Side = (typeof DIRECTIONS)[number]["side"];

export interface AlleywaysEdgeMap extends CompiledEdgeMap {
	stairsTiles: GridCoord[];
	interactableTiles: GridCoord[];
	natureTiles: GridCoord[];
	riverTiles: GridCoord[];
	bridgeTiles: GridCoord[];
	connectorTiles: GridCoord[];
	balconyTiles: GridCoord[];
	runwayTiles: GridCoord[];
}

/**
 * Converts the existing Alleyways "walls are tiles" blueprint directly
 * into the new edge-wall representation.
 *
 * There is NO new hand-authored edge array.
 *
 * The old logical dimensions and coordinates are preserved. Structural
 * cells become inferred ground and their wall/door/fence/glass material
 * is moved onto an EdgeGrid boundary.
 */
export function compileAlleywaysEdgeMap(
	blueprint: number[][],
): AlleywaysEdgeMap {
	assertRectangular(blueprint);

	const height = blueprint.length;
	const width = blueprint[0]?.length ?? 0;

	const grid = new Grid(width, height, TileType.Floor);
	const edges = createEmptyEdgeGrid(width, height);
	const elevation = new Map<string, number>();

	const stairsTiles: GridCoord[] = [];
	const interactableTiles: GridCoord[] = [];
	const natureTiles: GridCoord[] = [];
	const riverTiles: GridCoord[] = [];
	const bridgeTiles: GridCoord[] = [];
	const connectorTiles: GridCoord[] = [];
	const balconyTiles: GridCoord[] = [];
	const runwayTiles: GridCoord[] = [];

	/**
	 * Ground inferred underneath every old structural tile.
	 *
	 * The old wall occupied a complete cell. In the edge system that cell
	 * becomes real ground and the visible/physical wall moves to an edge.
	 */
	const structuralGround = inferStructuralGround(blueprint);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const coord = { x, y };
			const key = coordKey(coord);
			const code = blueprint[y][x] as LegacyAlleywaysCode;

			const ground = STRUCTURAL_CODES.has(code)
				? (structuralGround.get(key) ?? EdgeMapTileCode.Floor)
				: legacyCodeToGround(code);

			const blockedGround =
				ground === EdgeMapTileCode.Void ||
				ground === EdgeMapTileCode.River;

			grid.setTileType(
				coord,
				blockedGround ? TileType.Wall : TileType.Floor,
			);

			elevation.set(key, elevationForGround(ground, code));

			switch (code) {
				case LegacyAlleywaysCode.Stairs:
					stairsTiles.push(coord);
					break;
				case LegacyAlleywaysCode.Interactable:
					interactableTiles.push(coord);
					break;
				case LegacyAlleywaysCode.Nature:
					natureTiles.push(coord);
					break;
				case LegacyAlleywaysCode.River:
					riverTiles.push(coord);
					break;
				case LegacyAlleywaysCode.Bridge:
					bridgeTiles.push(coord);
					break;
				case LegacyAlleywaysCode.Connector:
					connectorTiles.push(coord);
					break;
				case LegacyAlleywaysCode.Balcony:
					balconyTiles.push(coord);
					break;
				case LegacyAlleywaysCode.Runway:
					runwayTiles.push(coord);
					break;
			}
		}
	}

	placeLegacyStructuresOnEdges(
		blueprint,
		structuralGround,
		edges,
	);

	return {
		grid,
		edges,
		elevation,
		stairsTiles,
		interactableTiles,
		natureTiles,
		riverTiles,
		bridgeTiles,
		connectorTiles,
		balconyTiles,
		runwayTiles,
	};
}

function placeLegacyStructuresOnEdges(
	blueprint: number[][],
	structuralGround: Map<string, EdgeMapTileCode>,
	edges: EdgeGrid,
): void {
	const height = blueprint.length;
	const width = blueprint[0]?.length ?? 0;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const code = blueprint[y][x] as LegacyAlleywaysCode;
			if (!STRUCTURAL_CODES.has(code)) continue;

			const coord = { x, y };
			const barrier = structuralCodeToBarrier(code);
			const thisGround =
				structuralGround.get(coordKey(coord)) ??
				EdgeMapTileCode.Floor;

			const terrainBoundarySides: Side[] = [];

			for (const direction of DIRECTIONS) {
				const neighbor = {
					x: x + direction.dx,
					y: y + direction.dy,
				};

				if (!isInBounds(neighbor, width, height)) continue;

				const neighborCode =
					blueprint[neighbor.y][neighbor.x] as LegacyAlleywaysCode;

				if (STRUCTURAL_CODES.has(neighborCode)) continue;

				const neighborGround = legacyCodeToGround(neighborCode);

				if (neighborGround !== thisGround) {
					terrainBoundarySides.push(direction.side);
				}
			}

			if (terrainBoundarySides.length > 0) {
				/**
				 * Normal exterior wall case:
				 *
				 * old:
				 *   outside | WALL CELL | interior
				 *
				 * new:
				 *   outside | EDGE WALL | interior ground
				 *
				 * The old wall cell is absorbed into whichever neighboring
				 * terrain was selected as its underlay.
				 */
				for (const side of terrainBoundarySides) {
					setBarrierOnSide(edges, coord, side, barrier);
				}
				continue;
			}

			/**
			 * Internal/ambiguous wall case.
			 *
			 * Both sides may be pavement, so terrain alone cannot tell us
			 * where the wall should sit. Use the shape of the old wall run:
			 * horizontal runs emit a north/south edge, vertical runs emit an
			 * east/west edge.
			 */
			const structuralNeighbors = new Set<Side>();

			for (const direction of DIRECTIONS) {
				const neighbor = {
					x: x + direction.dx,
					y: y + direction.dy,
				};

				if (!isInBounds(neighbor, width, height)) continue;

				const neighborCode =
					blueprint[neighbor.y][neighbor.x] as LegacyAlleywaysCode;

				if (STRUCTURAL_CODES.has(neighborCode)) {
					structuralNeighbors.add(direction.side);
				}
			}

			const horizontalConnections =
				Number(structuralNeighbors.has("E")) +
				Number(structuralNeighbors.has("W"));

			const verticalConnections =
				Number(structuralNeighbors.has("N")) +
				Number(structuralNeighbors.has("S"));

			if (
				horizontalConnections === 0 &&
				verticalConnections === 0
			) {
				/**
				 * Isolated old obstacle. There is no recoverable centerline,
				 * so preserve its blocked area by surrounding the converted
				 * ground cell.
				 */
				for (const side of ["N", "E", "S", "W"] as const) {
					setBarrierOnSide(edges, coord, side, barrier);
				}
				continue;
			}

			if (
				horizontalConnections >= verticalConnections &&
				horizontalConnections > 0
			) {
				setBarrierOnSide(
					edges,
					coord,
					chooseHorizontalSide(blueprint, coord),
					barrier,
				);
			}

			if (
				verticalConnections >= horizontalConnections &&
				verticalConnections > 0
			) {
				setBarrierOnSide(
					edges,
					coord,
					chooseVerticalSide(blueprint, coord),
					barrier,
				);
			}
		}
	}
}

function inferStructuralGround(
	blueprint: number[][],
): Map<string, EdgeMapTileCode> {
	const height = blueprint.length;
	const width = blueprint[0]?.length ?? 0;
	const ground = new Map<string, EdgeMapTileCode>();

	/**
	 * Pass 1: infer directly from non-structural cardinal neighbors.
	 */
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const code = blueprint[y][x] as LegacyAlleywaysCode;
			if (!STRUCTURAL_CODES.has(code)) continue;

			const candidates: EdgeMapTileCode[] = [];

			for (const direction of DIRECTIONS) {
				const neighbor = {
					x: x + direction.dx,
					y: y + direction.dy,
				};

				if (!isInBounds(neighbor, width, height)) continue;

				const neighborCode =
					blueprint[neighbor.y][neighbor.x] as LegacyAlleywaysCode;

				if (STRUCTURAL_CODES.has(neighborCode)) continue;

				candidates.push(legacyCodeToGround(neighborCode));
			}

			if (candidates.length > 0) {
				ground.set(
					`${x},${y}`,
					chooseGroundCandidate(candidates),
				);
			}
		}
	}

	/**
	 * Pass 2: propagate known ground through long solid wall runs whose
	 * middle cells had only structural neighbors in pass 1.
	 */
	let changed = true;

	while (changed) {
		changed = false;

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const key = `${x},${y}`;
				if (ground.has(key)) continue;

				const code = blueprint[y][x] as LegacyAlleywaysCode;
				if (!STRUCTURAL_CODES.has(code)) continue;

				const candidates: EdgeMapTileCode[] = [];

				for (const direction of DIRECTIONS) {
					const neighbor = {
						x: x + direction.dx,
						y: y + direction.dy,
					};

					if (!isInBounds(neighbor, width, height)) continue;

					const neighborGround = ground.get(
						coordKey(neighbor),
					);

					if (neighborGround !== undefined) {
						candidates.push(neighborGround);
					}
				}

				if (candidates.length > 0) {
					ground.set(key, chooseGroundCandidate(candidates));
					changed = true;
				}
			}
		}
	}

	/**
	 * Anything still unresolved is an enclosed structural island.
	 * Floor is the least destructive fallback because physical blocking
	 * now lives on its surrounding edges.
	 */
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const code = blueprint[y][x] as LegacyAlleywaysCode;
			if (!STRUCTURAL_CODES.has(code)) continue;

			const key = `${x},${y}`;
			if (!ground.has(key)) {
				ground.set(key, EdgeMapTileCode.Floor);
			}
		}
	}

	return ground;
}

function chooseGroundCandidate(
	candidates: EdgeMapTileCode[],
): EdgeMapTileCode {
	/**
	 * Pavement wins deliberately.
	 *
	 * Building interiors in Alleyways are already pavement. When an old
	 * wall cell touches interior pavement and exterior floor, absorbing
	 * that old cell into pavement gives the desired new geometry:
	 *
	 * exterior floor -> edge wall -> interior pavement.
	 */
	if (candidates.includes(EdgeMapTileCode.Pavement)) {
		return EdgeMapTileCode.Pavement;
	}

	if (candidates.includes(EdgeMapTileCode.Floor)) {
		return EdgeMapTileCode.Floor;
	}

	if (candidates.includes(EdgeMapTileCode.Nature)) {
		return EdgeMapTileCode.Nature;
	}

	if (candidates.includes(EdgeMapTileCode.River)) {
		return EdgeMapTileCode.River;
	}

	return EdgeMapTileCode.Floor;
}

function legacyCodeToGround(
	code: LegacyAlleywaysCode,
): EdgeMapTileCode {
	switch (code) {
		case LegacyAlleywaysCode.Void:
			return EdgeMapTileCode.Void;

		case LegacyAlleywaysCode.Pavement:
			return EdgeMapTileCode.Pavement;

		case LegacyAlleywaysCode.Nature:
			return EdgeMapTileCode.Nature;

		case LegacyAlleywaysCode.River:
			return EdgeMapTileCode.River;

		/**
		 * These remain special via their coordinate lists. Their tile
		 * underneath is ordinary walkable ground in the edge model.
		 */
		case LegacyAlleywaysCode.Connector:
		case LegacyAlleywaysCode.Interactable:
		case LegacyAlleywaysCode.Bridge:
		case LegacyAlleywaysCode.Balcony:
		case LegacyAlleywaysCode.Runway:
		case LegacyAlleywaysCode.Stairs:
			return EdgeMapTileCode.Floor;

		case LegacyAlleywaysCode.LowWall:
		case LegacyAlleywaysCode.Fence:
		case LegacyAlleywaysCode.Door:
		case LegacyAlleywaysCode.FullWall:
		case LegacyAlleywaysCode.Glass:
		case LegacyAlleywaysCode.Floor:
		default:
			return EdgeMapTileCode.Floor;
	}
}

function elevationForGround(
	ground: EdgeMapTileCode,
	legacyCode: LegacyAlleywaysCode,
): number {
	/**
	 * Keep the old feature elevations where they represent actual ground
	 * or platform height rather than a structural wall.
	 */
	switch (legacyCode) {
		case LegacyAlleywaysCode.Pavement:
			return 0.1;

		case LegacyAlleywaysCode.Balcony:
		case LegacyAlleywaysCode.Runway:
		case LegacyAlleywaysCode.Connector:
		case LegacyAlleywaysCode.Bridge:
		case LegacyAlleywaysCode.Stairs:
		case LegacyAlleywaysCode.Interactable:
			return 0;

		default:
			break;
	}

	switch (ground) {
		case EdgeMapTileCode.Pavement:
			return 0.1;

		case EdgeMapTileCode.Void:
		case EdgeMapTileCode.River:
			return Infinity;

		default:
			return 0;
	}
}

function structuralCodeToBarrier(
	code: LegacyAlleywaysCode,
): EdgeBarrier {
	switch (code) {
		case LegacyAlleywaysCode.LowWall:
			return EdgeBarrier.LowWall;

		case LegacyAlleywaysCode.Fence:
			return EdgeBarrier.Fence;

		case LegacyAlleywaysCode.Door:
			return EdgeBarrier.Door;

		case LegacyAlleywaysCode.Glass:
			return EdgeBarrier.Glass;

		case LegacyAlleywaysCode.FullWall:
		default:
			return EdgeBarrier.FullWall;
	}
}

function setBarrierOnSide(
	edges: EdgeGrid,
	coord: GridCoord,
	side: Side,
	barrier: EdgeBarrier,
): void {
	const direction = DIRECTIONS.find((entry) => entry.side === side);
	if (!direction) return;

	const neighbor = {
		x: coord.x + direction.dx,
		y: coord.y + direction.dy,
	};

	if (!isInBounds(neighbor, edges.width, edges.height)) return;

	const existing = getEdgeBetween(edges, coord, neighbor);

	setEdgeBetween(
		edges,
		coord,
		neighbor,
		mergeBarrier(existing, barrier),
	);
}

/**
 * When conversion heuristics converge onto the same edge, keep the most
 * semantically specific opening/material. In particular, Door must beat
 * FullWall so a neighboring legacy wall cannot reseal a doorway.
 */
function mergeBarrier(
	current: EdgeBarrier,
	incoming: EdgeBarrier,
): EdgeBarrier {
	const priority: Record<EdgeBarrier, number> = {
		[EdgeBarrier.None]: 0,
		[EdgeBarrier.LowWall]: 1,
		[EdgeBarrier.FullWall]: 2,
		[EdgeBarrier.Fence]: 3,
		[EdgeBarrier.Glass]: 4,
		[EdgeBarrier.Door]: 5,
	};

	return priority[incoming] >= priority[current]
		? incoming
		: current;
}

function chooseHorizontalSide(
	blueprint: number[][],
	coord: GridCoord,
): "N" | "S" {
	const northScore = outsideScore(
		blueprint,
		coord.x,
		coord.y - 1,
	);

	const southScore = outsideScore(
		blueprint,
		coord.x,
		coord.y + 1,
	);

	return southScore > northScore ? "S" : "N";
}

function chooseVerticalSide(
	blueprint: number[][],
	coord: GridCoord,
): "E" | "W" {
	const eastScore = outsideScore(
		blueprint,
		coord.x + 1,
		coord.y,
	);

	const westScore = outsideScore(
		blueprint,
		coord.x - 1,
		coord.y,
	);

	return eastScore > westScore ? "E" : "W";
}

function outsideScore(
	blueprint: number[][],
	x: number,
	y: number,
): number {
	const height = blueprint.length;
	const width = blueprint[0]?.length ?? 0;

	if (x < 0 || y < 0 || x >= width || y >= height) {
		return 100;
	}

	const code = blueprint[y][x] as LegacyAlleywaysCode;

	switch (code) {
		case LegacyAlleywaysCode.Void:
			return 90;

		case LegacyAlleywaysCode.River:
			return 80;

		case LegacyAlleywaysCode.Nature:
			return 70;

		case LegacyAlleywaysCode.Floor:
			return 60;

		case LegacyAlleywaysCode.Bridge:
			return 50;

		case LegacyAlleywaysCode.Pavement:
			return 10;

		default:
			return STRUCTURAL_CODES.has(code) ? 0 : 20;
	}
}

function isInBounds(
	coord: GridCoord,
	width: number,
	height: number,
): boolean {
	return (
		coord.x >= 0 &&
		coord.y >= 0 &&
		coord.x < width &&
		coord.y < height
	);
}

function assertRectangular(blueprint: number[][]): void {
	const width = blueprint[0]?.length ?? 0;

	for (let y = 0; y < blueprint.length; y++) {
		if (blueprint[y].length !== width) {
			throw new Error(
				`compileAlleywaysEdgeMap: row ${y} has ` +
					`${blueprint[y].length} cells; expected ${width}.`,
			);
		}
	}
}
