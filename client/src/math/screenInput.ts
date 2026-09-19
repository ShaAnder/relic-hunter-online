import type { Container } from "pixi.js";
import type { GridCoord } from "@relic-hunter/shared";
import {
	gridToScreenElevated,
	screenToGrid,
	TILE_WIDTH,
	TILE_HEIGHT,
} from "@/math/isoGridMath";

/** Canvas-local screen coordinates from a raw mouse event — accounts for CSS scaling between the canvas's actual pixel size and its rendered size. */
export function getScreenPoint(
	canvas: HTMLCanvasElement,
	event: MouseEvent,
): { screenX: number; screenY: number } {
	const rect = canvas.getBoundingClientRect();
	const scaleX = canvas.width / Math.max(1, rect.width);
	const scaleY = canvas.height / Math.max(1, rect.height);
	return {
		screenX: (event.clientX - rect.left) * scaleX,
		screenY: (event.clientY - rect.top) * scaleY,
	};
}

/**
 * Converts canvas-local screen coordinates to a grid tile, accounting
 * for the board container's own pan/zoom transform.
 *
 * When elevation data is supplied, a raised or sunken tile's clickable
 * diamond has moved from its flat-projection position - the plain
 * inverse-projection guess (flatGuess) is used as a starting point,
 * then a small neighborhood around it is searched using each
 * candidate tile's REAL elevated screen position, picking whichever
 * one's diamond actually contains the click point (preferring the
 * frontmost/highest-depth match when more than one diamond overlaps
 * the point, matching how the tiles themselves render on top of each
 * other).
 */
export function screenPointToGrid(
	boardContainer: Container,
	screenX: number,
	screenY: number,
	elevation?: Map<string, number>,
	gridWidth?: number,
	gridHeight?: number,
): GridCoord {
	const localX = (screenX - boardContainer.x) / boardContainer.scale.x;
	const localY = (screenY - boardContainer.y) / boardContainer.scale.y;

	const flatGuess = screenToGrid(localX, localY);

	if (!elevation || gridWidth === undefined || gridHeight === undefined) {
		return flatGuess;
	}

	// Even +10 is only one full tile-height vertically, so a small
	// neighbourhood around the ordinary inverse projection is enough.
	const SEARCH_RADIUS = 4;

	let best: { coord: GridCoord; depth: number; distance: number } | null = null;

	for (
		let y = flatGuess.y - SEARCH_RADIUS;
		y <= flatGuess.y + SEARCH_RADIUS;
		y++
	) {
		for (
			let x = flatGuess.x - SEARCH_RADIUS;
			x <= flatGuess.x + SEARCH_RADIUS;
			x++
		) {
			if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) continue;

			const coord = { x, y };
			const position = gridToScreenElevated(coord, elevation);

			const normalizedX = Math.abs(localX - position.x) / (TILE_WIDTH / 2);
			const normalizedY = Math.abs(localY - position.y) / (TILE_HEIGHT / 2);
			const diamondDistance = normalizedX + normalizedY;

			if (diamondDistance > 1) continue;

			const depth = position.y + TILE_HEIGHT / 2;

			if (
				!best ||
				depth > best.depth ||
				(Math.abs(depth - best.depth) < 0.001 &&
					diamondDistance < best.distance)
			) {
				best = { coord, depth, distance: diamondDistance };
			}
		}
	}

	return best?.coord ?? flatGuess;
}
