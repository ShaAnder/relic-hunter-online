import { Container, Graphics } from "pixi.js";
import { GridCoord } from "@relic-hunter/shared";
import { gridToScreen } from "../math/isoGridMath";
import { easeInOutCubic } from "@/math/easeInOutCubic";

const SPHERE_RADIUS = 12;
const MOVE_DURATION_PER_TILE_MS = 180;

/**
 * Animated on-screen hunter token. Visual only — real position lives in MercenaryState.
 * Moves as one continuous ease across the whole path, not tile-by-tile.
 * @param initialCoord - starting grid position
 * @param bodyColor - sphere fill color, defaults to player red
 * @author ShaAnder
 */
export class Mercenary {
	readonly view = new Container();

	// Animation state — polyline is [startPos, ...pathTiles]
	private currentScreenPos: { x: number; y: number };
	private animPoints: { x: number; y: number }[] = [];
	private animElapsedMs = 0;
	private animDurationMs = 0;
	private onPathComplete: (() => void) | null = null;
	private _isAnimating = false;

	constructor(
		initialCoord: GridCoord,
		private bodyColor: number = 0xe74c3c,
	) {
		this.currentScreenPos = gridToScreen(initialCoord);
		this.view.addChild(this.drawSphere());
		this.syncPosition();
	}

	/** True while a move animation is in progress. */
	get isAnimating(): boolean {
		return this._isAnimating;
	}

	/**
	 * Animate across the whole path with one ease curve.
	 * @param path - tiles to visit in order
	 * @param durationMsOverride - explicit duration, for non-walked flights (e.g. Exit card)
	 */
	moveAlongPath(path: GridCoord[], durationMsOverride?: number): Promise<void> {
		return new Promise((resolve) => {
			// Empty path or already animating: resolve immediately, don't hang
			if (path.length === 0 || this._isAnimating) {
				resolve();
				return;
			}

			this.animPoints = [
				{ ...this.currentScreenPos },
				...path.map(gridToScreen),
			];
			this.animElapsedMs = 0;
			this.animDurationMs =
				durationMsOverride ?? path.length * MOVE_DURATION_PER_TILE_MS;
			this._isAnimating = true;
			this.onPathComplete = resolve;
		});
	}

	/** Advance the animation — call once per frame. */
	update(deltaTime: number): void {
		if (!this._isAnimating || this.animPoints.length < 2) return;

		this.animElapsedMs += (deltaTime / 60) * 1000;

		const t = Math.min(this.animElapsedMs / this.animDurationMs, 1);
		const eased = easeInOutCubic(t);

		this.currentScreenPos = interpolatePolyline(this.animPoints, eased);
		this.syncPosition();

		if (t >= 1) {
			// Snap to kill float drift
			const final = this.animPoints[this.animPoints.length - 1];
			this.currentScreenPos = { x: final.x, y: final.y };
			this.syncPosition();

			this._isAnimating = false;
			this.animPoints = [];
			this.animElapsedMs = 0;
			this.animDurationMs = 0;

			const cb = this.onPathComplete;
			this.onPathComplete = null;
			cb?.();
		}
	}

	/** Push tracked position onto the Pixi view. */
	private syncPosition(): void {
		this.view.x = this.currentScreenPos.x;
		this.view.y = this.currentScreenPos.y;
	}

	/** Placeholder sphere until the sprite sheet lands. */
	private drawSphere(): Graphics {
		const g = new Graphics();

		g.ellipse(0, 4, SPHERE_RADIUS * 0.8, SPHERE_RADIUS * 0.3);
		g.fill({ color: 0x000000, alpha: 0.35 });

		g.circle(0, -SPHERE_RADIUS, SPHERE_RADIUS);
		g.fill(this.bodyColor);

		g.circle(-SPHERE_RADIUS * 0.3, -SPHERE_RADIUS * 1.4, SPHERE_RADIUS * 0.4);
		g.fill({ color: 0xffffff, alpha: 0.5 });

		return g;
	}
}

/** Point along a polyline at normalized t, constant speed via cumulative segment lengths. */
function interpolatePolyline(
	points: { x: number; y: number }[],
	t: number,
): { x: number; y: number } {
	if (points.length === 0) return { x: 0, y: 0 };
	if (t <= 0) return { ...points[0] };
	if (t >= 1) return { ...points[points.length - 1] };

	const lengths: number[] = [0];
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		total += Math.sqrt(dx * dx + dy * dy);
		lengths.push(total);
	}

	if (total === 0) return { ...points[0] };

	const targetDist = t * total;

	for (let i = 1; i < lengths.length; i++) {
		if (targetDist <= lengths[i]) {
			const segStart = lengths[i - 1];
			const segLen = lengths[i] - segStart;
			const localT = segLen === 0 ? 0 : (targetDist - segStart) / segLen;
			const a = points[i - 1];
			const b = points[i];
			return {
				x: a.x + (b.x - a.x) * localT,
				y: a.y + (b.y - a.y) * localT,
			};
		}
	}

	return { ...points[points.length - 1] };
}
