import { Container } from "pixi.js";

/**
 * Interface for anything shown on top of the active scene without
 * replacing it — pause menus, confirm dialogs, future modal prompts.
 * Deliberately similar in shape to Scene, but a distinct concept: an
 * Overlay never tears down whatever's underneath it. OverlayManager owns
 * showing/hiding; the underlying scene keeps existing, just paused.
 */
export interface Overlay {
	readonly view: Container;

	// Called once when the overlay is shown. Can be async if it needs to
	// build UI or load anything first.
	onShow(): void | Promise<void>;

	// Cleanup — remove listeners, stop timers. No promise needed.
	onHide(): void;

	// Per-frame tick, same contract as Scene.update. Most overlays (a
	// static pause menu) won't need this, but it's here for ones that do.
	update(deltaTime: number): void;

	onResize(width: number, height: number): void;
}
