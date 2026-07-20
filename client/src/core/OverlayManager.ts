import { Container } from "pixi.js";
import type { Overlay } from "./Overlay";

/**
 * Layers a single Overlay on top of the currently active scene without
 * calling into SceneManager at all — the scene underneath is never told
 * to exit, its view is never removed, its state is untouched. Scenes are
 * responsible for pausing their own update()/input handling by checking
 * `isOpen`; OverlayManager only owns the overlay's own lifecycle and
 * where it sits in the stage.
 *
 * Deliberately separate from SceneManager rather than folding this into
 * a full push/pop scene stack — SceneManager's single-scene, full-replace
 * design is intentional (see its own docblock), and pause/confirm-dialog
 * style UI is a narrower need that doesn't require rearchitecting it.
 */
export class OverlayManager {
	private stage: Container;
	private current: Overlay | null = null;

	constructor(stage: Container) {
		this.stage = stage;
	}

	/** Whether an overlay is currently showing. Scenes check this to pause themselves. */
	get isOpen(): boolean {
		return this.current !== null;
	}

	/** Show an overlay on top of the stage. Replaces any overlay already showing. */
	async show(overlay: Overlay): Promise<void> {
		if (this.current) this.hide();

		await overlay.onShow();
		this.current = overlay;
		this.stage.addChild(overlay.view);
	}

	/** Hide the current overlay, if any. No-ops if nothing is showing. */
	hide(): void {
		if (!this.current) return;

		this.current.onHide();
		this.stage.removeChild(this.current.view);
		this.current = null;
	}

	/** Forward the per-frame tick to the current overlay, if any. */
	update(deltaTime: number): void {
		this.current?.update(deltaTime);
	}

	/** Forward resize events to the current overlay, if any. */
	onResize(width: number, height: number): void {
		this.current?.onResize(width, height);
	}
}
