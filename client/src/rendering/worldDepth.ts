import type { Container } from "pixi.js";

export const WORLD_DEPTH_BIAS = {
	terrainFace: 0,
	barrierSegment: 0.1,
	barrierConnector: 0.2,
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
