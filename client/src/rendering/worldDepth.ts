import type { Container } from "pixi.js";

export const WORLD_DEPTH_BIAS = {
	terrainFace: 0,
	barrierSegment: 0.1,
	barrierConnector: 0.2,

	/**
	 * Narrow foreground-tile strip used where a tile edge meets a
	 * structural barrier.
	 *
	 * It draws after barrier segments/connectors at the same projected
	 * ground contact, but before chests/entities standing on that tile.
	 */
	terrainOccluder: 0.25,

	chest: 0.3,
	entity: 0.4,
} as const;

export function setWorldDepth(
	view: Container,
	groundY: number,
	bias = 0,
): void {
	view.zIndex = groundY + bias;
}
