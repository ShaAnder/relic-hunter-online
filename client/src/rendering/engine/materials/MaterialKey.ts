import type {
	EdgeBarrier,
	EdgeMapTileCode,
	GridCoord,
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
			code: EdgeMapTileCode | undefined;
			variantHash: number;
			fallbackColor: number;
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
 * Exact deterministic hash currently used by mapMaterialFactory.
 *
 * Phase 2 converts this stable hash into an actual texture index:
 *
 *     variantHash % family.length
 *
 * Keeping the raw hash here means the pure compiler never needs to know
 * how many Pixi textures have been loaded.
 */
export function tileVariantHash(
	mapSeed: number,
	floorIndex: number,
	coord: GridCoord,
	code: EdgeMapTileCode | undefined,
): number {
	let h = mapSeed | 0;

	h ^= Math.imul(floorIndex + 1, 0x9e3779b1);
	h ^= Math.imul(coord.x + 1, 0x85ebca6b);
	h ^= Math.imul(coord.y + 1, 0xc2b2ae35);

	/**
	 * Undefined has no current texture family, so its exact hash does not
	 * affect visible output. -1 deliberately maps `code + 1` to zero.
	 */
	h ^= Math.imul((code ?? -1) + 1, 0x27d4eb2f);

	h ^= h >>> 16;
	h = Math.imul(h, 0x7feb352d);

	h ^= h >>> 15;
	h = Math.imul(h, 0x846ca68b);

	h ^= h >>> 16;

	return h >>> 0;
}
