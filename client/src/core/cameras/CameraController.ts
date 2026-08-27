import { Container, Ticker } from "pixi.js";

import { easeInOutCubic } from "@/math/easeInOutCubic";

export interface CameraOptions {
	initialZoom?: number;
	minZoom?: number;
	maxZoom?: number;
	zoomSpeed?: number;
	panSpeed?: number;
}

export interface WorldBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

export type WorldPositionClamper = (worldPos: { x: number; y: number }) => {
	x: number;
	y: number;
};

const DEFAULTS: Required<CameraOptions> = {
	initialZoom: 1.75,
	minZoom: 0.75,
	maxZoom: 3,
	zoomSpeed: 0.001,
	panSpeed: 700,
};

/**
 * Owns client-side camera state and behaviour.
 *
 * Responsibilities:
 * - world/container pan
 * - zoom
 * - generic world clamping
 * - camera locking
 * - centering
 * - cinematic pan
 * - camera shake
 * - keyboard / wheel camera input
 *
 * This class deliberately knows nothing about:
 * - maps
 * - tiles
 * - HUDs
 * - gameplay rules
 * - turns
 * - entities
 *
 * Map-specific bounds are supplied through setWorldClamp().
 *
 * @author ShaAnderton
 */
export class CameraController {
	private target: Container;
	private options: Required<CameraOptions>;

	private heldKeys = new Set<string>();

	private lockedWorldPosition: { x: number; y: number } | null = null;

	private inputLocked = false;

	/**
	 * Cached every frame because wheel events originate outside the
	 * normal game update loop.
	 */
	private screenWidth = 0;
	private screenHeight = 0;

	private worldClamp: WorldPositionClamper | null = null;

	constructor(target: Container, options: CameraOptions = {}) {
		this.target = target;
		this.options = {
			...DEFAULTS,
			...options,
		};

		this.target.scale.set(this.options.initialZoom);
	}

	get isLocked(): boolean {
		return this.lockedWorldPosition !== null;
	}

	get isInputLocked(): boolean {
		return this.inputLocked;
	}

	get zoom(): number {
		return this.target.scale.x;
	}

	get position(): { x: number; y: number } {
		return {
			x: this.target.x,
			y: this.target.y,
		};
	}

	attach(canvas: HTMLCanvasElement): void {
		window.addEventListener("keydown", this.handleKeyDown);
		window.addEventListener("keyup", this.handleKeyUp);

		canvas.addEventListener("wheel", this.handleWheel, {
			passive: false,
		});

		window.addEventListener("contextmenu", this.handleContextMenu);

		window.addEventListener("blur", this.handleWindowBlur);
	}

	detach(canvas: HTMLCanvasElement): void {
		window.removeEventListener("keydown", this.handleKeyDown);
		window.removeEventListener("keyup", this.handleKeyUp);

		canvas.removeEventListener("wheel", this.handleWheel);

		window.removeEventListener("contextmenu", this.handleContextMenu);

		window.removeEventListener("blur", this.handleWindowBlur);

		this.heldKeys.clear();
	}

	/**
	 * MapScene supplies the map-specific clamp.
	 *
	 * CameraController itself has no knowledge of tiles or map geometry.
	 */
	setWorldClamp(fn: WorldPositionClamper | null): void {
		this.worldClamp = fn;
	}

	lockTo(worldPosition: { x: number; y: number }): void {
		this.lockedWorldPosition = worldPosition;
	}

	unlock(): void {
		this.lockedWorldPosition = null;
	}

	centerOn(
		worldPosition: { x: number; y: number },
		screenWidth: number,
		screenHeight: number,
	): void {
		this.target.x = screenWidth / 2 - worldPosition.x * this.target.scale.x;

		this.target.y = screenHeight / 2 - worldPosition.y * this.target.scale.y;
	}

	/**
	 * Brief random jitter around the camera's current position.
	 */
	shake(durationMs: number, intensity: number): Promise<void> {
		return new Promise((resolve) => {
			const baseX = this.target.x;
			const baseY = this.target.y;
			const startTime = performance.now();

			const tick = (): void => {
				const elapsedMs = performance.now() - startTime;

				if (elapsedMs >= durationMs) {
					this.target.x = baseX;
					this.target.y = baseY;

					Ticker.shared.remove(tick);
					resolve();
					return;
				}

				const falloff = 1 - elapsedMs / durationMs;

				this.target.x = baseX + (Math.random() * 2 - 1) * intensity * falloff;

				this.target.y = baseY + (Math.random() * 2 - 1) * intensity * falloff;
			};

			Ticker.shared.add(tick);
		});
	}

	/**
	 * Scripted cinematic pan from the current camera centre
	 * to a world position.
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

				this.centerOn(
					{
						x: worldX,
						y: worldY,
					},
					screenWidth,
					screenHeight,
				);

				if (t >= 1) {
					Ticker.shared.remove(tick);
					resolve();
				}
			};

			Ticker.shared.add(tick);
		});
	}

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
	 * Blocks camera input without destroying listeners.
	 */
	setInputLocked(locked: boolean): void {
		this.inputLocked = locked;

		if (locked) {
			this.heldKeys.clear();
		}
	}

	private applyWorldClamp(): void {
		if (!this.worldClamp) return;

		const scale = this.target.scale.x;

		const centerX = this.screenWidth / 2;
		const centerY = this.screenHeight / 2;

		const currentWorld = {
			x: (centerX - this.target.x) / scale,

			y: (centerY - this.target.y) / scale,
		};

		const clamped = this.worldClamp(currentWorld);

		this.target.x = centerX - clamped.x * scale;

		this.target.y = centerY - clamped.y * scale;
	}

	private applyPan(deltaTime: number): void {
		if (this.heldKeys.size === 0) return;

		const distance = (this.options.panSpeed * deltaTime) / 60;

		if (this.heldKeys.has("w")) {
			this.target.y += distance;
		}

		if (this.heldKeys.has("s")) {
			this.target.y -= distance;
		}

		if (this.heldKeys.has("a")) {
			this.target.x += distance;
		}

		if (this.heldKeys.has("d")) {
			this.target.x -= distance;
		}

		this.applyWorldClamp();
	}

	private handleContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
	};

	private handleWindowBlur = (): void => {
		this.heldKeys.clear();
	};

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

		const centerX = this.screenWidth / 2;

		const centerY = this.screenHeight / 2;

		const worldX = (centerX - this.target.x) / oldScale;

		const worldY = (centerY - this.target.y) / oldScale;

		this.target.scale.set(newScale);

		this.target.x = centerX - worldX * newScale;

		this.target.y = centerY - worldY * newScale;

		this.applyWorldClamp();
	};
}

function clamp(val: number, min: number, max: number): number {
	return Math.min(Math.max(val, min), max);
}
