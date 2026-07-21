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
 *
 * panTo() is a separate, self-contained scripted pan — it runs on PixiJS's
 * own shared ticker rather than through update(), specifically so it keeps
 * working even during a scene transition that suppresses update() calls.
 * See panTo()'s own docblock for why that matters.
 */
export class Camera {
	private target: Container;
	private options: Required<CameraOptions>;
	private heldKeys = new Set<string>();
	private lockedWorldPosition: { x: number; y: number } | null = null;

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
	}

	detach(canvas: HTMLCanvasElement): void {
		window.removeEventListener("keydown", this.handleKeyDown);
		window.removeEventListener("keyup", this.handleKeyUp);
		canvas.removeEventListener("wheel", this.handleWheel);
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
	 *
	 * Deliberately self-driving via PixiJS's global Ticker.shared rather
	 * than depending on this scene's own update() being called — SceneManager
	 * blocks update() for whatever scene is currently inside an in-flight
	 * onEnter() (see its own docblock: "Blocks per-frame updates during
	 * transitions"). If this pan's progress depended on that update() call,
	 * awaiting it from inside onEnter() would deadlock forever: the promise
	 * can only resolve once enough ticks have advanced it, but those ticks
	 * are exactly what's suppressed while onEnter() is pending. Driving it
	 * from the shared ticker instead sidesteps that entirely — it advances
	 * regardless of any scene's transition state.
	 *
	 * screenWidth/screenHeight are taken as explicit parameters rather than
	 * reading cached instance fields, since those fields are normally kept
	 * fresh by the owning scene's update() — which, for the same reason
	 * above, may never have run yet when a scene calls panTo() from its own
	 * onEnter(). Reading a stale (possibly still-zero) cached value would
	 * silently produce garbage camera positions.
	 *
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
			// If the main thread was busy just before this (e.g. building a
			// large map's tile graphics synchronously), the ticker's first
			// tick afterward can report a hugely inflated deltaMS — it can't
			// tick while JS is blocked, so that whole gap gets folded into
			// whichever tick runs next. Accumulating that would jump elapsed
			// straight past durationMs on frame one, resolving the pan
			// instantly and invisibly. performance.now() sidesteps this
			// entirely: elapsed is always "now minus when we started."
			// https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
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
	private handleKeyDown = (event: KeyboardEvent): void => {
		this.heldKeys.add(event.key.toLowerCase());
	};

	private handleKeyUp = (event: KeyboardEvent): void => {
		this.heldKeys.delete(event.key.toLowerCase());
	};

	private handleWheel = (event: WheelEvent): void => {
		event.preventDefault();

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
