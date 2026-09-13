import type { GridCoord, StaircaseCluster } from "@relic-hunter/shared";
import {
	coordKey,
	findStaircaseClusterAt,
	staircaseClimbProgress,
} from "@relic-hunter/shared";

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

/** How far an entity visually rises over the full length of a staircase, in the same px-per-elevation-unit terms as ELEVATION_PX_PER_UNIT. Deliberately larger than a single elevation unit: for a horizontal (left-to-right) staircase, each step right also moves the tile ~TILE_HEIGHT/2 px *down* on screen from the isometric projection itself, which very nearly cancels a same-sized climb rise and made the effect invisible in practice at ELEVATION_PX_PER_UNIT. Doubled so the net rise stays clearly visible on any orientation. */
export const STAIRCASE_CLIMB_PX = ELEVATION_PX_PER_UNIT * 2;

/**
 * Same as gridToScreenElevated, but also layers a staircase's own
 * progressive climb on top when coord sits on one — an entity partway
 * up a staircase rises smoothly toward STAIRCASE_CLIMB_PX by the top
 * tile, on top of whatever elevation that specific tile already has.
 * Omitting clusters, or a coord that isn't part of any cluster, both
 * fall back to plain gridToScreenElevated.
 */
export function gridToScreenElevatedWithClimb(
	coord: GridCoord,
	elevation: Map<string, number> | undefined,
	clusters: StaircaseCluster[] | undefined,
): { x: number; y: number } {
	const base = gridToScreenElevated(coord, elevation);
	if (!clusters || clusters.length === 0) return base;
	const cluster = findStaircaseClusterAt(clusters, coord);
	if (!cluster) return base;
	const progress = staircaseClimbProgress(cluster, coord);
	return { x: base.x, y: base.y - progress * STAIRCASE_CLIMB_PX };
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
