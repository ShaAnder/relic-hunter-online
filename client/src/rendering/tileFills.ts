import { EdgeMapTileCode } from "@relic-hunter/shared";

/**
 * Muted, in-game fill colors for tile codes that need to read as
 * something other than plain floor/pavement - stairs and ladders
 * specifically. Deliberately NOT the Map Creator's own bright editing
 * palette colors (those exist purely to be tellable-apart on a small
 * painting grid, not meant to carry into the finished map - same
 * reasoning as the wall/fence/door colors in MapRenderer itself).
 *
 * StairStep and StairConnector are intentionally left out - both are
 * meant to blend with the ordinary floor around them (a connector's
 * distinct elevation already reads clearly enough on its own; a step
 * is just part of the walkable path, not a landmark).
 */
const TILE_FILL_OVERRIDES: Partial<Record<EdgeMapTileCode, number>> = {
	[EdgeMapTileCode.StairBottom]: 0x7a6a4a,
	[EdgeMapTileCode.StairTop]: 0x8a7a5a,
	[EdgeMapTileCode.LadderBottom]: 0x5a4a3a,
	[EdgeMapTileCode.LadderTop]: 0x6a5a4a,
};

/** Looks up the in-game fill override for a raw tile code, or undefined if that code has no override (plain floor/pavement/void, or a code this map doesn't otherwise render specially). */
export function fillForTileCode(code: number | undefined): number | undefined {
	if (code === undefined) return undefined;
	return TILE_FILL_OVERRIDES[code as EdgeMapTileCode];
}
