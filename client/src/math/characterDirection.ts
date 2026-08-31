import type { GridCoord } from "@relic-hunter/shared";
import type { CharacterDirection, IsoFacing } from "@/types/characterSprite";
import { toIsoFacing } from "@/types/characterSprite";

/**
 * Grid step → isometric facing.
 * TILE projection: +x → SE, +y → SW, -x → NW, -y → NE.
 */
export function getIsoFacing(from: GridCoord, to: GridCoord): IsoFacing {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (dx === 0 && dy === 0) return "se";

	// Pure axis first
	if (dy === 0 && dx > 0) return "se";
	if (dy === 0 && dx < 0) return "nw";
	if (dx === 0 && dy > 0) return "sw";
	if (dx === 0 && dy < 0) return "ne";

	// Diagonals on grid — pick dominant visual iso quadrant
	if (dx > 0 && dy > 0) return Math.abs(dx) >= Math.abs(dy) ? "se" : "sw";
	if (dx > 0 && dy < 0) return Math.abs(dx) >= Math.abs(dy) ? "se" : "ne";
	if (dx < 0 && dy > 0) return Math.abs(dx) >= Math.abs(dy) ? "nw" : "sw";
	return Math.abs(dx) >= Math.abs(dy) ? "nw" : "ne";
}

/** @deprecated use getIsoFacing */
export function getCharacterDirection(
	from: GridCoord,
	to: GridCoord,
): CharacterDirection {
	return getIsoFacing(from, to);
}

/**
 * Map logical facing → sheet facing + optional flipX.
 * With four authored iso facings, flipX is almost always false.
 */
export function resolveSheetDirection(
	dir: CharacterDirection | IsoFacing,
): { sheetDir: IsoFacing; flipX: boolean } {
	const iso = toIsoFacing(dir);
	return { sheetDir: iso, flipX: false };
}

export function directionUsesFlipX(_dir: CharacterDirection): boolean {
	return false;
}

export function directionMirrorSource(
	dir: CharacterDirection,
): CharacterDirection {
	return toIsoFacing(dir);
}
