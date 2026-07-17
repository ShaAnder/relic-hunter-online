import type { GridCoord } from "@relic-hunter/shared";

/**
 * ISO Projection math - converts between our grid coords / tile pixel space
 * Centralized here so we have an SSO for everything
 * (tiles, movement range, highlight / entities ect)
 *
 * Rendering problem so lives in client instead of shared
 */

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

export function gridToScreen(coord: GridCoord): { x: number; y: number } {
	return {
		x: (coord.x - coord.y) * (TILE_WIDTH / 2),
		y: (coord.x + coord.y) * (TILE_HEIGHT / 2),
	};
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
