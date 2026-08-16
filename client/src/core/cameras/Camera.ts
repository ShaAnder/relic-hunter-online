import { Container, Ticker } from "pixi.js";
import { easeInOutCubic } from "@/math/easeInOutCubic";

export interface CameraOptions {
	initialZoom?: number;
	minZoom?: number;
	maxZoom?: number;
	zoomSpeed?: number;
	panSpeed?: number;
}

const DEFAULTS: Required<CameraOptions> = {
	initialZoom: 1.75,
	minZoom: 0.75,
	maxZoom: 3,
	zoomSpeed: 0.001,
	panSpeed: 700,
};

/**
 * Controls pan (WASD) and zoom (mouse wheel) for a Pixi Container acting as
 * a "camera"
 *
 * Two modes drive update()'s per-frame behavior:
 *  - Free: player can pan/zoom freely. Default, and the only mode right now.
 *  - Locked: camera snaps to and follows a given world position every frame,
 *    ignoring pan input.
 */
export class Camera {
	private target: Container;
	private options: Required<CameraOptions>;
	private heldKeys = new Set<string>();
	private lockedWorldPosition: { x: number; y: number } | null = null;
	private inputLocked = false;

	// Cached every frame via update() — handleWheel fires from a DOM event,
	// not the game loop, so it has no other way to know the current screen size.
	private screenWidth = 0;
	private screenHeight = 0;

	constructor(target: Container, options: CameraOptions = {}) {
		this.target = target;
		this.options = { ...DEFAULTS, ...options };
		this.target.scale.set(this.options.initialZoom);
	}

	attach(canvas: HTMLCanvasElement): void {
		window.addEventListener("keydown", this.handleKeyDown);
		window.addEventListener("keyup", this.handleKeyUp);
		// create canvas event for mouse wheel, we pass in passive: false, this lets us
		// call preventDefault() so we zoom camera instead of srooling the page
		canvas.addEventListener("wheel", this.handleWheel, { passive: false });
		canvas.addEventListener("contextmenu", this.handleContextMenu);
		window.addEventListener("blur", this.handleWindowBlur);
	}

	detach(canvas: HTMLCanvasElement): void {
		window.removeEventListener("keydown", this.handleKeyDown);
		window.removeEventListener("keyup", this.handleKeyUp);
		canvas.removeEventListener("wheel", this.handleWheel);
		canvas.removeEventListener("contextmenu", this.handleContextMenu);
		window.removeEventListener("blur", this.handleWindowBlur);
	}

	lockTo(worldPosition: { x: number; y: number }): void {
		this.lockedWorldPosition = worldPosition;
	}

	unlock(): void {
		this.lockedWorldPosition = null;
	}

	get isLocked(): boolean {
		return this.lockedWorldPosition !== null;
	}

	// Centering camera position (snap to next player)
	centerOn(
		worldPosition: { x: number; y: number },
		screenWidth: number,
		screenHeight: number,
	): void {
		this.target.x = screenWidth / 2 - worldPosition.x * this.target.scale.x;
		this.target.y = screenHeight / 2 - worldPosition.y * this.target.scale.y;
	}

	/**
	 * Scripted cinematic pan from the camera's current center to a target
	 * position, eased over durationMs.
	 * *
	 * Overrides free-pan and any active lock while running.
	 */
	panTo(
		worldPosition: { x: number; y: number },
		durationMs: number,
		screenWidth: number,
		screenHeight: number,
	): Promise<void> {
		return new Promise((resolve) => {
			const currentWorldCenter = {
				x: (screenWidth / 2 - this.target.x) / this.target.scale.x,
				y: (screenHeight / 2 - this.target.y) / this.target.scale.y,
			};

			// Wall-clock timestamp rather than accumulating ticker.deltaMS.
			const startTime = performance.now();

			const tick = (): void => {
				const elapsedMs = performance.now() - startTime;
				const t = Math.min(elapsedMs / durationMs, 1);
				const eased = easeInOutCubic(t);

				const worldX =
					currentWorldCenter.x +
					(worldPosition.x - currentWorldCenter.x) * eased;
				const worldY =
					currentWorldCenter.y +
					(worldPosition.y - currentWorldCenter.y) * eased;

				this.centerOn({ x: worldX, y: worldY }, screenWidth, screenHeight);

				if (t >= 1) {
					Ticker.shared.remove(tick);
					resolve();
				}
			};

			Ticker.shared.add(tick);
		});
	}

	// Update camera position when something happens - does nothing
	// right now but will follow players on their turn / monsters ect
	update(deltaTime: number, screenWidth: number, screenHeight: number): void {
		this.screenWidth = screenWidth;
		this.screenHeight = screenHeight;

		if (this.lockedWorldPosition) {
			this.centerOn(this.lockedWorldPosition, screenWidth, screenHeight);
			return;
		}
		this.applyPan(deltaTime);
	}

	/**
	 * Blocks the browser's native right-click menu over the canvas —
	 * that menu stealing focus is the actual root cause of the camera-catapult bug,
	 * since a held key's keyup event never reaches this listener once
	 * focus moves away from the canvas.
	 */
	private handleContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
	};

	/**
	 * ANY loss of window focus (alt-tab, a browser dialog, anything else that steals it)
	 * can strand a held key the exact same way. Clearing on blur means a
	 * stuck key can never survive longer than one focus loss, regardless of what caused it.
	 */
	private handleWindowBlur = (): void => {
		this.heldKeys.clear();
	};

	// apply camera pan speed
	private applyPan(deltaTime: number): void {
		if (this.heldKeys.size === 0) return;

		const distance = (this.options.panSpeed * deltaTime) / 60;

		if (this.heldKeys.has("w")) this.target.y += distance;
		if (this.heldKeys.has("s")) this.target.y -= distance;
		if (this.heldKeys.has("a")) this.target.x += distance;
		if (this.heldKeys.has("d")) this.target.x -= distance;
	}

	// handle key events - down, up, scroll wheel
	/** Blocks all pan/zoom input at the source — functionally the same as removing the listeners, without the risk of a leak from repeated attach/detach. */
	setInputLocked(locked: boolean): void {
		this.inputLocked = locked;
		if (locked) this.heldKeys.clear();
	}

	private handleKeyDown = (event: KeyboardEvent): void => {
		if (this.inputLocked) return;
		this.heldKeys.add(event.key.toLowerCase());
	};

	private handleKeyUp = (event: KeyboardEvent): void => {
		if (this.inputLocked) return;
		this.heldKeys.delete(event.key.toLowerCase());
	};

	private handleWheel = (event: WheelEvent): void => {
		event.preventDefault();
		if (this.inputLocked) return;

		const oldScale = this.target.scale.x;
		const zoomDelta = -event.deltaY * this.options.zoomSpeed;
		const newScale = clamp(
			oldScale + oldScale * zoomDelta,
			this.options.minZoom,
			this.options.maxZoom,
		);

		// Zoom in place: anchor on the screen's CENTER instead of the cursor,
		// so zooming never shifts what's in view — it only scales it.
		const centerX = this.screenWidth / 2;
		const centerY = this.screenHeight / 2;

		const worldX = (centerX - this.target.x) / oldScale;
		const worldY = (centerY - this.target.y) / oldScale;

		this.target.scale.set(newScale);
		this.target.x = centerX - worldX * newScale;
		this.target.y = centerY - worldY * newScale;
	};
}

// clamp function
function clamp(val: number, min: number, max: number): number {
	return Math.min(Math.max(val, min), max);
}
