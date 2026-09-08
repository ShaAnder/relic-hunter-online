import { Grid, TileType, GridCoord } from "./grid";

/**
 * Numeric code a gen algo stamps into the blueprint, small and generic
 * a generator only needs to know floor vs wall vs marker, nothing else
 */
export enum BlueprintCode {
	Floor = 0,
	Wall = 2,
	EnvironmentMarker = 2,
	InteractableMarker = 3,
}

/**
 * Generation algorithms working format, row major (blueprint[y][x])
 * matching how people sketch map by hand, NOT the same shape as GRID
 * which is a plain number[][]
 */
export type MapBlueprint = BlueprintCode[][];

// function to create rows, pushes an empty Blueprint of walls
export function createBlueprint(
	width: number,
	height: number,
	fill: BlueprintCode = BlueprintCode.Wall,
): MapBlueprint {
	const rows: MapBlueprint = [];
	for (let y = 0; y < height; y++) {
		rows.push(new Array(width).fill(fill));
	}
	return rows;
}

// get bp width
export function blueprintWidth(bp: MapBlueprint): number {
	return bp[0]?.length ?? 0;
}

// get bp height
export function blueprintHeight(bp: MapBlueprint): number {
	return bp.length;
}

// check if in bounds
export function inBounds(bp: MapBlueprint, coord: GridCoord): boolean {
	return (
		coord.x >= 0 &&
		coord.y >= 0 &&
		coord.x < blueprintWidth(bp) &&
		coord.y < blueprintHeight(bp)
	);
}

// get the code of any one tile
export function getCode(bp: MapBlueprint, coord: GridCoord): BlueprintCode {
	return bp[coord.y]?.[coord.x] ?? BlueprintCode.Wall;
}

// set the code of any one tile
export function setCode(
	bp: MapBlueprint,
	coord: GridCoord,
	code: BlueprintCode,
): void {
	if (!inBounds(bp, coord)) return;
	bp[coord.y][coord.x] = code;
}

// Once blueprint is built, compile it into a grid
export interface CompiledBlueprint {
	grid: Grid;
	environmentMarkers: GridCoord[];
	interactableMarkers: GridCoord[];
}

/**
 * Converts a blueprint into the real Grid the rest of the game already
 * knows how to use. Floor/Wall codes become real tile types directly;
 * marker codes become Floor tiles (a marker still has to be walkable
 * ground) plus a coord recorded in the matching list
 */
export function CompiledBlueprint(bp: MapBlueprint): CompiledBlueprint {
	const width = blueprintWidth(bp);
	const height = blueprintHeight(bp);
	const grid = new Grid(width, height, TileType.Wall);

	const environmentMarkers: GridCoord[] = [];
	const interactableMarkers: GridCoord[] = [];

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const coord = { x, y };
			const code = bp[y][x];

			switch (code) {
				case BlueprintCode.Wall:
					grid.setTileType(coord, TileType.Wall);
					break;
				case BlueprintCode.Floor:
					grid.setTileType(coord, TileType.Floor);
					break;
				case BlueprintCode.EnvironmentMarker:
					grid.setTileType(coord, TileType.Floor);
					environmentMarkers.push(coord);
					break;
				case BlueprintCode.InteractableMarker:
					grid.setTileType(coord, TileType.Floor);
					interactableMarkers.push(coord);
					break;
			}
		}
	}
	return { grid, environmentMarkers, interactableMarkers };
}
