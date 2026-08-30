import type { Container } from "pixi.js";
import type { GridCoord } from "@relic-hunter/shared";
import { screenToGrid } from "@/math/isoGridMath";

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

/** Converts canvas-local screen coordinates to a grid tile, accounting for the board container's own pan/zoom transform. */
export function screenPointToGrid(
	boardContainer: Container,
	screenX: number,
	screenY: number,
): GridCoord {
	const localX = (screenX - boardContainer.x) / boardContainer.scale.x;
	const localY = (screenY - boardContainer.y) / boardContainer.scale.y;
	return screenToGrid(localX, localY);
}
