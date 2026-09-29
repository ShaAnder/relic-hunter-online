import type { Container } from "pixi.js";
import { DynamicDepthController } from "@/rendering/engine/dynamic/DynamicDepthController";
export {
	WORLD_DEPTH_BIAS,
	worldBoundaryDepth,
} from "@/rendering/engine/world/worldDepthKey";

/**
 * Compatibility shim for existing dynamic entities.
 *
 * Each Pixi Container receives one persistent DynamicDepthController through a
 * WeakMap. This lets Phase 4 improve dynamic depth behavior without forcing an
 * unrelated rewrite of every entity class at the same time.
 */
const controllers = new WeakMap<Container, DynamicDepthController>();

export function setWorldDepth(
	view: Container,
	groundY: number,
	bias = 0,
): void {
	let controller = controllers.get(view);
	if (!controller) {
		controller = new DynamicDepthController();
		controllers.set(view, controller);
	}
	controller.update(view, groundY, bias);
}
