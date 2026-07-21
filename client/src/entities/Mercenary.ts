import { Container, Graphics } from "pixi.js";
import { GridCoord } from "@relic-hunter/shared";
import { gridToScreen } from "../math/isoGridMath";
import { easeInOutCubic } from "@/math/easeInOutCubic";

const SPHERE_RADIUS = 12;
const MOVE_DURATION_PER_TILE_MS = 180;

/**
 * Animated on-screen token for a hunter. Visual representation only —
 * authoritative position lives in MercenaryState.
 *
 * Movement plays as one continuous ease-in/out across the whole committed
 * path rather than easing tile-by-tile, so the token glides instead of
 * pausing at every step. In Phase 3 the server-validated path feeds into
 * moveAlongPath unchanged.
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

	constructor(initialCoord: GridCoord) {
		this.currentScreenPos = gridToScreen(initialCoord);
		this.view.addChild(this.drawSphere());
		this.syncPosition();
	}

	/** True while a move animation is in progress — blocks new input. */
	get isAnimating(): boolean {
		return this._isAnimating;
	}

	/**
	 * Animate smoothly across the entire path with one ease curve.
	 * Resolves once the final tile is visually reached.
	 *
	 * @param path Tiles to visit, in order. path[0] is the first tile after
	 *   the current position — this is the normal walked-route case.
	 * @param durationMsOverride When provided, use this exact duration
	 *   instead of `path.length * MOVE_DURATION_PER_TILE_MS`. Needed for
	 *   cases like the Exit card's straight-line flight, where the "path"
	 *   is a single long-distance waypoint (skipping normal pathing
	 *   entirely) that would otherwise get an unrealistically short
	 *   duration from the per-tile formula.
	 */
	moveAlongPath(path: GridCoord[], durationMsOverride?: number): Promise<void> {
		return new Promise((resolve) => {
			// Empty path or double-call: resolve immediately rather than
			// leaving a promise hanging forever.
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

	/** Advance the animation; call once per frame from the scene. */
	update(deltaTime: number): void {
		if (!this._isAnimating || this.animPoints.length < 2) return;

		// Convert deltaTime (frames) into milliseconds so timing stays consistent
		this.animElapsedMs += (deltaTime / 60) * 1000;

		const t = Math.min(this.animElapsedMs / this.animDurationMs, 1);
		const eased = easeInOutCubic(t);

		this.currentScreenPos = interpolatePolyline(this.animPoints, eased);
		this.syncPosition();

		if (t >= 1) {
			// Snap exactly onto the final tile to kill float drift
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

	/** Push the tracked screen position onto the Pixi view. */
	private syncPosition(): void {
		this.view.x = this.currentScreenPos.x;
		this.view.y = this.currentScreenPos.y;
	}

	/** Simple fake-3D sphere placeholder until the sprite sheet lands. */
	private drawSphere(): Graphics {
		const g = new Graphics();

		// Shadow
		g.ellipse(0, 4, SPHERE_RADIUS * 0.8, SPHERE_RADIUS * 0.3);
		g.fill({ color: 0x000000, alpha: 0.35 });

		// Body
		g.circle(0, -SPHERE_RADIUS, SPHERE_RADIUS);
		g.fill(0xe74c3c);

		// Highlight
		g.circle(-SPHERE_RADIUS * 0.3, -SPHERE_RADIUS * 1.4, SPHERE_RADIUS * 0.4);
		g.fill({ color: 0xffffff, alpha: 0.5 });

		return g;
	}
}

/**
 * Position along a polyline at normalized t, travelling at constant speed.
 * Maps t to distance via cumulative segment lengths so uneven segments
 * don't change the apparent speed — any speed variation comes from easing
 * t before it gets here.
 */
function interpolatePolyline(
	points: { x: number; y: number }[],
	t: number,
): { x: number; y: number } {
	if (points.length === 0) return { x: 0, y: 0 };
	if (t <= 0) return { ...points[0] };
	if (t >= 1) return { ...points[points.length - 1] };

	// Cumulative distance along the line
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

	// Find the segment targetDist lands in, then lerp inside it
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
