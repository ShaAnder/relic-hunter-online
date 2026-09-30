import type {
	EdgeBarrier,
	GridCoord,
	GroundMaterialId,
} from "@relic-hunter/shared";

/**
 * Backend-neutral material identity.
 *
 * The compiler describes WHAT material a surface needs.
 * Pixi texture/material resolution happens later in the renderer.
 */
export type VisualMaterialRef =
	| {
			kind: "tile";
			materialId: GroundMaterialId;
			variantHash: number;
	  }
	| {
			kind: "terrain";
			fallbackColor: number;
	  }
	| {
			kind: "barrier";
			barrier: EdgeBarrier;
			surface:
				| "segment-face"
				| "segment-top"
				| "connector-face"
				| "connector-top";
			fallbackColor: number;
			alpha: number;
	  };

/**
 * Stable variation seed for one authored ground tile.
 *
 * Material identity intentionally does not participate. Repainting a tile with
 * another material does not need to reshuffle the tile<s deterministic local
 * variation — the same hash is simply interpreted modulo the new material<s
 * variant count.
 */
export function groundVariantHash(
	mapSeed: number,
	floorIndex: number,
	coord: GridCoord,
): number {
	let h = mapSeed | 0;

	h ^= Math.imul(floorIndex + 1, 0x9e3779b1);
	h ^= Math.imul(coord.x + 1, 0x85ebca6b);
	h ^= Math.imul(coord.y + 1, 0xc2b2ae35);
	h ^= h >>> 16;
	h = Math.imul(h, 0x7feb352d);
	h ^= h >>> 15;
	h = Math.imul(h, 0x846ca68b);
	h ^= h >>> 16;

	return h >>> 0;
}
