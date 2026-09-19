import { EdgeMapTileCode } from "@relic-hunter/shared";

/**
 * Material controls appearance.
 *
 * Elevation never decides what material a tile visually represents.
 */
const TILE_FILL_OVERRIDES: Partial<Record<EdgeMapTileCode, number>> = {
	[EdgeMapTileCode.Floor]: 0xc8c8c8,

	[EdgeMapTileCode.Pavement]: 0xaaaac8,

	[EdgeMapTileCode.Road]: 0x66666f,

	[EdgeMapTileCode.Nature]: 0x96c850,

	[EdgeMapTileCode.StairBottom]: 0x7a6a4a,

	[EdgeMapTileCode.StairTop]: 0x8a7a5a,

	[EdgeMapTileCode.LadderBottom]: 0x5a4a3a,

	[EdgeMapTileCode.LadderTop]: 0x6a5a4a,
};

export function fillForTileCode(code: number | undefined): number | undefined {
	if (code === undefined) {
		return undefined;
	}

	return TILE_FILL_OVERRIDES[code as EdgeMapTileCode];
}
