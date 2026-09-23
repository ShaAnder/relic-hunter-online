import {
	coordKey,
	type CompiledEdgeMap,
	type EdgeMapTileCode,
	type GridCoord,
} from "@relic-hunter/shared";

/**
 * TOPOLOGY DIRECTION BITMASKS
 * ---------------------------
 *
 * We want one number to be able to describe several neighbouring
 * directions at the same time.
 *
 * To do that, each direction gets its own unique BINARY BIT:
 *
 *                Decimal    Binary
 *
 * North             1       0001
 * East              2       0010
 * South             4       0100
 * West              8       1000
 *
 * Notice that each number is a power of two:
 *
 *     1, 2, 4, 8
 *
 * That is important because each value occupies a different binary
 * position. None of the directions share the same bit.
 *
 * To accomplish this we use JS shiftwise operator to << in a direction *
 *
 * WHY IS THIS USEFUL?
 * -------------------
 *
 * Because we can combine these bits using the bitwise OR operator `|`.
 *
 * Example:
 *
 *     North = 0001   we add these together (the positions NOT the actual digits)
 *     East  = 0010   so North + East (or 1 + 2) (or 0001 + 0010) = 0011 or 3
 *
 * Binary 0011 is decimal 3.
 *
 * Therefore:
 *
 *     3 = North + East
 *
 *
 * IMPORTANT:
 *
 * Binary "0011" is decimal 3.
 * Decimal 11 is NOT the same thing.
 * Decimal 11 in binary is:
 *
 *     1011
 *
 * which means:
 *
 *     North = on
 *     East  = on
 *     South = off
 *     West  = on
 *
 * So decimal 11 means:
 *
 *     North + East + West
 *
 * TLDR we do 0011 we say north + east OR northeast
 */
export const TOPOLOGY_N = 1 << 0;
export const TOPOLOGY_E = 1 << 1;
export const TOPOLOGY_S = 1 << 2;
export const TOPOLOGY_W = 1 << 3;

const ELEVATION_EPSILON = 0.000001;

export interface CompiledTileTopology {
	// Neighbours with the same tile/material code.
	sameMaterialMask: number;
	// Neighbours that are in bounds and have finite render elevation.
	renderableMask: number;
	//Renderable neighbours physically higher than this tile.
	higherMask: number;
	// Renderable neighbours physically lower than this tile.
	lowerMask: number;
}

interface Direction {
	bit: number;
	dx: number;
	dy: number;
}

const DIRECTIONS: readonly Direction[] = [
	{
		bit: TOPOLOGY_N,
		dx: 0,
		dy: -1,
	},
	{
		bit: TOPOLOGY_E,
		dx: 1,
		dy: 0,
	},
	{
		bit: TOPOLOGY_S,
		dx: 0,
		dy: 1,
	},
	{
		bit: TOPOLOGY_W,
		dx: -1,
		dy: 0,
	},
];

/**
 * Compiles the four-cardinal-neighbour topology for one renderable tile.
 *
 * This is pure renderer/compiler data. It does not create Pixi objects
 * and does not depend on fog, focus or current presentation state.
 */
export function compileTileTopology(
	compiled: CompiledEdgeMap,
	coord: GridCoord,
): CompiledTileTopology {
	const currentKey = coordKey(coord);

	const currentElevation = compiled.elevation.get(currentKey);

	const currentCode: EdgeMapTileCode | undefined =
		compiled.tileCodes.get(currentKey);

	let sameMaterialMask = 0;
	let renderableMask = 0;
	let higherMask = 0;
	let lowerMask = 0;

	/**
	 * This function is expected to be called only for renderable tiles.
	 * Keep the defensive guard so accidental use on Void data produces a
	 * harmless empty topology instead of misleading neighbour relations.
	 */
	if (currentElevation === undefined || !Number.isFinite(currentElevation)) {
		return { sameMaterialMask, renderableMask, higherMask, lowerMask };
	}

	for (const direction of DIRECTIONS) {
		const neighbour: GridCoord = {
			x: coord.x + direction.dx,
			y: coord.y + direction.dy,
		};

		if (
			neighbour.x < 0 ||
			neighbour.y < 0 ||
			neighbour.x >= compiled.grid.width ||
			neighbour.y >= compiled.grid.height
		) {
			continue;
		}
		const neighbourKey = coordKey(neighbour);

		const neighbourElevation = compiled.elevation.get(neighbourKey);

		if (
			neighbourElevation === undefined ||
			!Number.isFinite(neighbourElevation)
		) {
			continue;
		}

		renderableMask |= direction.bit;

		const neighbourCode = compiled.tileCodes.get(neighbourKey);

		if (neighbourCode === currentCode) {
			sameMaterialMask |= direction.bit;
		}

		if (neighbourElevation > currentElevation + ELEVATION_EPSILON) {
			higherMask |= direction.bit;
		} else if (neighbourElevation < currentElevation - ELEVATION_EPSILON) {
			lowerMask |= direction.bit;
		}
	}

	return {
		sameMaterialMask,
		renderableMask,
		higherMask,
		lowerMask,
	};
}
