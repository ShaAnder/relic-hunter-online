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
	/** When true, MapScene must not dismiss this overlay on Escape. */
	readonly blocksEscape?: boolean;

	onShow(): void | Promise<void>;
	onHide(): void;
	update(deltaTime: number): void;
	onResize(width: number, height: number): void;
}
