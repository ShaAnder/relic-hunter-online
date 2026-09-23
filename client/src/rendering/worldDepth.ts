import type { Container } from "pixi.js";

export { WORLD_DEPTH_BIAS } from "@/rendering/engine/world/worldDepthKey";

/**
 * Legacy runtime helper.
 *
 * The pure compiler does NOT import this module because this file depends
 * on Pixi.
 *
 * Existing dynamic entities may continue using it until their Phase 4
 * persistent depth handling replaces repeated zIndex writes.
 */
export function setWorldDepth(
	view: Container,
	groundY: number,
	bias = 0,
): void {
	view.zIndex = groundY + bias;
}
