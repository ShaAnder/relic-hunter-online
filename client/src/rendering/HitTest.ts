import type { Container } from "pixi.js";

export function pointInRect(
	px: number,
	py: number,
	x: number,
	y: number,
	w: number,
	h: number,
): boolean {
	return px >= x && px <= x + w && py >= y && py <= y + h;
}

export function pointInCircle(
	px: number,
	py: number,
	cx: number,
	cy: number,
	radius: number,
): boolean {
	const dx = px - cx;
	const dy = py - cy;
	return dx * dx + dy * dy <= radius * radius;
}

/** Bounds-based check against a live Container's current rendered position — for panels whose size isn't a fixed constant. */
export function pointInContainer(
	px: number,
	py: number,
	container: Container,
): boolean {
	if (!container.visible) return false;
	const bounds = container.getBounds();
	return pointInRect(px, py, bounds.x, bounds.y, bounds.width, bounds.height);
}
