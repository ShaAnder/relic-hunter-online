import { Container } from "pixi.js";
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
 * Two modes:
 *  - Free: player can pan/zoom freely. Default, and the only mode right now.
 *  - Locked: camera snaps to and follows a given world position every frame,
 *    ignoring pan input.
 */
export class Camera {
	private target: Container;
	private options: Required<CameraOptions>;
	private heldKeys = new Set<string>();
	private lockedWorldPosition: { x: number; y: number } | null = null;

	// Scripted pan state, null when no pan is in progress
	private panning: {
		from: { x: number; y: number };
		to: { x: number; y: number };
		elapsedMs: number;
		durationMs: number;
		resolve: () => void;
	} | null = null;

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
	 * Scripted cinematic pan from the cameras current center to
	 * target position eased over duration ms.
	 *
	 * Overrides free-pan and any active lock while running
	 */
	panTo(
		worldPosition: { x: number; y: number },
		durationMs: number,
	): Promise<void> {
		return new Promise((resolve) => {
			// Reverse centerOns math to recover the world point currently
			// centered on screen - the pans true starting position
			const currentWorldCenter = {
				x: (this.screenWidth / 2 - this.target.x) / this.target.scale.x,
				y: (this.screenHeight / 2 - this.target.y) / this.target.scale.y,
			};

			this.panning = {
				from: currentWorldCenter,
				to: worldPosition,
				elapsedMs: 0,
				durationMs,
				resolve,
			};
		});
	}

	// Update camera position when something happens - does nothing
	// right now but will follow players on their turn / monsters ect
	update(deltaTime: number, screenWidth: number, screenHeight: number): void {
		this.screenWidth = screenWidth;
		this.screenHeight = screenHeight;

		if (this.panning) {
			this.advancePan(deltaTime, screenWidth, screenHeight);
			return;
		}

		if (this.lockedWorldPosition) {
			this.centerOn(this.lockedWorldPosition, screenWidth, screenHeight);
			return;
		}
		this.applyPan(deltaTime);
	}

	/* Advance the in-progress scripted pan by one tick, resolving on completion */
	private advancePan(
		deltaTime: number,
		screenWidth: number,
		screenHeight: number,
	): void {
		if (!this.panning) return;

		this.panning.elapsedMs += (deltaTime / 60) * 1000;
		const time = Math.min(this.panning.elapsedMs / this.panning.durationMs, 1);
		const eased = easeInOutCubic(time);

		const worldX =
			this.panning.from.x + (this.panning.to.x - this.panning.from.x) * eased;
		const worldY =
			this.panning.from.y + (this.panning.to.y - this.panning.from.y) * eased;

		this.centerOn({ x: worldX, y: worldY }, screenWidth, screenHeight);

		if (time >= 1) {
			const resolve = this.panning.resolve;
			this.panning = null;
			resolve();
		}
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
