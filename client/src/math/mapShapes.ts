import { TileType, type GridCoord } from "@relic-hunter/shared";

/**
 * The one real map-shape mechanism — every tile in `walkable` stays
 * Floor, everything else in the width×height grid becomes Wall. Named
 * shape helpers below (tShapeWalkableTiles, etc.) each just compute a
 * GridCoord[] to feed in here — there's no separate "kind" dispatch,
 * since every shape is ultimately just a walkable-tile list.
 */
export function buildCustomShapeOverrides(
	width: number,
	height: number,
	walkable: GridCoord[],
): { coord: GridCoord; type: TileType }[] {
	const walkableSet = new Set(walkable.map((c) => `${c.x},${c.y}`));
	const overrides: { coord: GridCoord; type: TileType }[] = [];

	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			if (walkableSet.has(`${x},${y}`)) continue;
			overrides.push({ coord: { x, y }, type: TileType.Wall });
		}
	}

	return overrides;
}

/**
 * Walkable tiles for a T shape — a horizontal head plus a vertical
 * stem. Feed the result straight into buildCustomShapeOverrides. Add a
 * new helper like this one only once a shape is genuinely needed by a
 * real script, not speculatively.
 */
export function tShapeWalkableTiles(
	width: number,
	height: number,
	headRows: number,
	stemStartX: number,
	stemWidth: number,
): GridCoord[] {
	const tiles: GridCoord[] = [];
	const stemEndX = stemStartX + stemWidth - 1;

	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			const inHead = y < headRows;
			const inStem = x >= stemStartX && x <= stemEndX;
			if (inHead || inStem) tiles.push({ x, y });
		}
	}

	return tiles;
}
