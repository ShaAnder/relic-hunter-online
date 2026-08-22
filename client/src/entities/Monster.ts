import { Container, Graphics } from "pixi.js";
import { GridCoord } from "@relic-hunter/shared";
import type { MonsterTier } from "@relic-hunter/shared";
import { gridToScreen } from "@/math/isoGridMath";
import { easeInOutCubic } from "@/math/easeInOutCubic";

const TIER_COLORS: Record<MonsterTier, number> = {
	light: 0x7bbf6a,
	medium: 0xd98c3a,
	heavy: 0xd3333c,
	boss: 0x7c3c3c,
};

const TIER_SIZE: Record<MonsterTier, { w: number; h: number }> = {
	light: { w: 22, h: 32 },
	medium: { w: 26, h: 38 },
	heavy: { w: 30, h: 44 },
	boss: { w: 38, h: 54 },
};

const MOVE_DURATION_PER_TILE_MS = 180;

/**
 * On-screen monster token — an upright standing diamond (narrower than
 * tall), distinct from the flat, wide iso floor-tile diamonds. Same
 * frame-driven, whole-path-eased animation technique as Mercenary, so
 * monster and hunter movement read identically — update(deltaTime) is
 * called externally each frame, not a self-driven RAF loop.
 * @param initialCoord - starting grid position
 * @param tier - light/medium/heavy, governs size and color
 * @author ShaAnder
 */
export class MonsterToken {
	readonly view = new Container();

	private currentScreenPos: { x: number; y: number };
	private animPoints: { x: number; y: number }[] = [];
	private animElapsedMs = 0;
	private animDurationMs = 0;
	private onPathComplete: (() => void) | null = null;
	private _isAnimating = false;

	constructor(initialCoord: GridCoord, tier: MonsterTier) {
		this.currentScreenPos = gridToScreen(initialCoord);
		this.view.addChild(this.drawDiamond(tier));
		this.syncPosition();
	}

	get isAnimating(): boolean {
		return this._isAnimating;
	}

	moveAlongPath(path: GridCoord[], durationMsOverride?: number): Promise<void> {
		return new Promise((resolve) => {
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

	/** Advance the animation — call once per frame, same as Mercenary.update(). */
	update(deltaTime: number): void {
		if (!this._isAnimating || this.animPoints.length < 2) return;

		this.animElapsedMs += (deltaTime / 60) * 1000;

		const t = Math.min(this.animElapsedMs / this.animDurationMs, 1);
		const eased = easeInOutCubic(t);

		this.currentScreenPos = interpolatePolyline(this.animPoints, eased);
		this.syncPosition();

		if (t >= 1) {
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

	private syncPosition(): void {
		this.view.x = this.currentScreenPos.x;
		this.view.y = this.currentScreenPos.y;
	}

	/** Upright standing diamond — taller than wide, distinct from a flat floor tile. */
	private drawDiamond(tier: MonsterTier): Graphics {
		const { w, h } = TIER_SIZE[tier];
		const g = new Graphics();

		g.ellipse(0, 4, w * 0.5, h * 0.15);
		g.fill({ color: 0x000000, alpha: 0.35 });

		g.poly([0, -h, w / 2, -h / 2, 0, 0, -w / 2, -h / 2]);
		g.fill(TIER_COLORS[tier]);
		g.stroke({ width: 2, color: 0x1a1a1a, alpha: 0.7 });

		return g;
	}
}

/** Point along a polyline at normalized t, constant speed via cumulative segment lengths — identical technique to Mercenary's. */
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
			return { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
		}
	}

	return { ...points[points.length - 1] };
}
