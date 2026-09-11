import type { GridCoord } from "@relic-hunter/shared";
import { coordKey } from "@relic-hunter/shared";

/**
 * ISO Projection math - converts between our grid coords / tile pixel space
 * Centralized here so we have an SSO for everything
 * (tiles, movement range, highlight / entities ect)
 *
 * Rendering problem so lives in client instead of shared
 */

export const TILE_WIDTH = 80;
export const TILE_HEIGHT = 40;

/** Pixels a tile (or anything standing on it) rises per full (1.0) elevation unit — matches TILE_HEIGHT, same scale MapRenderer uses for tiles themselves, so entities standing on raised ground line up with the raised tile under their feet rather than floating at the old ground level. */
export const ELEVATION_PX_PER_UNIT = TILE_HEIGHT;

export function gridToScreen(coord: GridCoord): { x: number; y: number } {
	return {
		x: (coord.x - coord.y) * (TILE_WIDTH / 2),
		y: (coord.x + coord.y) * (TILE_HEIGHT / 2),
	};
}

/**
 * Same as gridToScreen, but raises the result by the tile's own
 * elevation — the "stepping up onto the pavement" effect for entities
 * (mercenaries, monsters, chests) standing on or moving across raised
 * ground. Pass the map's per-tile elevation data (session.mapElevation);
 * omitting it or a tile with no entry both fall back to plain
 * gridToScreen (elevation 0), so this is safe to use everywhere
 * gridToScreen was used before, even on maps with no elevation data.
 */
export function gridToScreenElevated(
	coord: GridCoord,
	elevation?: Map<string, number>,
): { x: number; y: number } {
	const base = gridToScreen(coord);
	const value = elevation?.get(coordKey(coord));
	if (value === undefined || !Number.isFinite(value)) return base;
	return { x: base.x, y: base.y - value * ELEVATION_PX_PER_UNIT };
}

// Inverse of gridToScreen. Takes board-LOCAL coordinates — the caller is responsible
// for first undoing camera pan/zoom to get into this space.
export function screenToGrid(localX: number, localY: number): GridCoord {
	const a = localX / (TILE_WIDTH / 2);
	const b = localY / (TILE_HEIGHT / 2);

	return {
		x: Math.round((a + b) / 2),
		y: Math.round((b - a) / 2),
	};
}