import { Container } from "pixi.js";
import type { Overlay } from "./Overlay";

/**
 * Layers overlays on top of the currently active scene without calling
 * into SceneManager at all — the scene underneath is never told to
 * exit, its view is never removed, its state is untouched.
 *
 * Backed by a real stack, not a single slot — `show()`/`hide()` keep
 * their original, exclusive "replace everything" behavior exactly as
 * before
 *
 * Deliberately separate from SceneManager rather than folding this
 * into a full push/pop scene stack — SceneManager's single-scene,
 * full-replace design is intentional
 */
export class OverlayManager {
	private stage: Container;
	private stack: Overlay[] = [];

	constructor(stage: Container) {
		this.stage = stage;
	}

	/** Whether ANY overlay is currently showing, at any stack depth — */
	get isOpen(): boolean {
		return this.stack.length > 0;
	}

	/** The TOPMOST overlay, if any — scenes use this for Escape policy,  */
	get active(): Overlay | null {
		return this.stack[this.stack.length - 1] ?? null;
	}

	/**
	 * Show an overlay exclusively — replaces the ENTIRE stack, exactly
	 * as before. Unchanged behavior, unchanged signature; every
	 * existing caller keeps working with no changes needed.
	 *
	 * The overlay's view is added to the stage — and it's pushed onto
	 * the stack — BEFORE awaiting onShow(), not after.
	 */
	async show(overlay: Overlay): Promise<void> {
		this.clearStack();

		this.stack.push(overlay);
		this.stage.addChild(overlay.view);

		await overlay.onShow();
	}

	/** Hide everything — clears the entire stack */
	hide(): void {
		this.clearStack();
	}

	/**
	 * Layers a new overlay ON TOP of whatever's already showing,
	 * without touching it
	 */
	async showOnTop(overlay: Overlay): Promise<void> {
		this.stack.push(overlay);
		this.stage.addChild(overlay.view);

		await overlay.onShow();
	}

	/** Removes just the TOPMOST overlay, restoring whatever was underneath  */
	hideTop(): void {
		const top = this.stack.pop();
		if (!top) return;

		top.onHide();
		this.stage.removeChild(top.view);
	}

	private clearStack(): void {
		while (this.stack.length > 0) {
			const overlay = this.stack.pop()!;
			overlay.onHide();
			this.stage.removeChild(overlay.view);
		}
	}

	/** Forward the per-frame tick to the TOPMOST overlay only  */
	update(deltaTime: number): void {
		this.active?.update(deltaTime);
	}

	/** Forward resize events to the TOPMOST overlay only. */
	onResize(width: number, height: number): void {
		this.active?.onResize(width, height);
	}
}
