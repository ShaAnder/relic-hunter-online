import { Container, Graphics } from "pixi.js";
import type { GridCoord } from "@relic-hunter/shared";
import { gridToScreen } from "@/math/isoGridMath";
import { easeInOutCubic } from "@/math/easeInOutCubic";
import { CharacterSprite } from "@/entities/CharacterSprite";
import {
	toSpriteCharacterClass,
	type SpriteCharacterClass,
} from "@/types/characterSprite";
import { getIsoFacing } from "@/math/characterDirection";

const SPHERE_RADIUS = 12;
const MOVE_DURATION_PER_TILE_MS = 180;

/**
 * Animated hunter token. Visual only — grid position lives in MercenaryState.
 */
export class Mercenary {
	readonly view = new Container();

	private currentScreenPos: { x: number; y: number };
	private animPoints: { x: number; y: number }[] = [];
	private animElapsedMs = 0;
	private animDurationMs = 0;
	private onPathComplete: (() => void) | null = null;
	private _isAnimating = false;

	private readonly shadow: Graphics;
	private readonly placeholder: Graphics;
	private readonly sprite: CharacterSprite;
	private spriteReady = false;
	private lastPathCoords: GridCoord[] = [];

	constructor(
		initialCoord: GridCoord,
		characterClass: string | SpriteCharacterClass = "brawler",
		private bodyColor: number = 0xe74c3c,
	) {
		this.currentScreenPos = gridToScreen(initialCoord);

		this.shadow = this.drawShadow();
		this.view.addChild(this.shadow);

		this.sprite = new CharacterSprite(toSpriteCharacterClass(characterClass));
		this.view.addChild(this.sprite.view);

		this.placeholder = this.drawPlaceholderBody();
		this.view.addChild(this.placeholder);

		void this.sprite.init().then((ok) => {
			this.spriteReady = ok;
			if (!ok) return;
			this.placeholder.visible = false;
			// The load can finish mid-move (it's async, movement isn't
			// blocked on it) — if that happens, show the walk animation
			// immediately rather than the idle pose init() already set,
			// which would otherwise pop in as a jarring "standing still
			// while sliding across the tile" glitch for one frame.
			if (this._isAnimating) {
				void this.sprite.play("walk");
			}
		});

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

			this.lastPathCoords = path;
			this.applyFacingFromPath(path);

			this.animPoints = [
				{ ...this.currentScreenPos },
				...path.map(gridToScreen),
			];
			this.animElapsedMs = 0;
			this.animDurationMs =
				durationMsOverride ?? path.length * MOVE_DURATION_PER_TILE_MS;
			this._isAnimating = true;
			this.onPathComplete = resolve;

			if (this.spriteReady) {
				void this.sprite.play("walk");
			}
		});
	}

	setPositionInstant(screenPos: { x: number; y: number }): void {
		this.currentScreenPos = { ...screenPos };
		this.syncPosition();
		if (this.spriteReady) {
			void this.sprite.play("idle");
		}
	}

	update(deltaTime: number): void {
		if (this.spriteReady) {
			this.sprite.update(deltaTime);
		}

		if (!this._isAnimating || this.animPoints.length < 2) return;

		this.animElapsedMs += (deltaTime / 60) * 1000;
		const t = Math.min(this.animElapsedMs / this.animDurationMs, 1);
		const eased = easeInOutCubic(t);

		this.currentScreenPos = interpolatePolyline(this.animPoints, eased);
		this.syncPosition();

		if (this.spriteReady) {
			this.updateFacingForProgress(eased);
		}

		if (t >= 1) {
			const final = this.animPoints[this.animPoints.length - 1]!;
			this.currentScreenPos = { x: final.x, y: final.y };
			this.syncPosition();

			this._isAnimating = false;
			this.animPoints = [];
			this.animElapsedMs = 0;
			this.animDurationMs = 0;
			this.lastPathCoords = [];

			if (this.spriteReady) {
				void this.sprite.play("idle");
			}

			const cb = this.onPathComplete;
			this.onPathComplete = null;
			cb?.();
		}
	}

	private applyFacingFromPath(path: GridCoord[]): void {
		if (path.length >= 2) {
			this.sprite.setDirection(getIsoFacing(path[0]!, path[1]!));
		}
	}

	private updateFacingForProgress(t: number): void {
		if (this.lastPathCoords.length < 2 || this.animPoints.length < 2) return;

		const points = this.animPoints;
		const lengths: number[] = [0];
		let total = 0;
		for (let i = 1; i < points.length; i++) {
			const dx = points[i]!.x - points[i - 1]!.x;
			const dy = points[i]!.y - points[i - 1]!.y;
			total += Math.sqrt(dx * dx + dy * dy);
			lengths.push(total);
		}
		if (total === 0) return;

		const targetDist = Math.min(1, Math.max(0, t)) * total;
		let segmentIndex = 1;
		for (let i = 1; i < lengths.length; i++) {
			if (targetDist <= lengths[i]!) {
				segmentIndex = i;
				break;
			}
			segmentIndex = i;
		}

		if (segmentIndex >= 2) {
			const from = this.lastPathCoords[segmentIndex - 2]!;
			const to = this.lastPathCoords[segmentIndex - 1]!;
			this.sprite.setDirection(getIsoFacing(from, to));
		} else if (this.lastPathCoords.length >= 2) {
			this.sprite.setDirection(
				getIsoFacing(this.lastPathCoords[0]!, this.lastPathCoords[1]!),
			);
		}
	}

	private syncPosition(): void {
		// Integer-pixel snapping — sub-pixel positions combined with
		// nearest-neighbor texture scaling (required for crisp pixel art
		// at non-integer camera zoom) otherwise shimmer/jitter visibly as
		// the fractional part crosses a pixel boundary each frame.
		this.view.x = Math.round(this.currentScreenPos.x);
		this.view.y = Math.round(this.currentScreenPos.y);
	}

	private drawShadow(): Graphics {
		const g = new Graphics();
		g.ellipse(0, 2, SPHERE_RADIUS * 0.9, SPHERE_RADIUS * 0.35);
		g.fill({ color: 0x000000, alpha: 0.35 });
		return g;
	}

	private drawPlaceholderBody(): Graphics {
		const g = new Graphics();
		g.circle(0, -SPHERE_RADIUS, SPHERE_RADIUS);
		g.fill(this.bodyColor);
		g.circle(-SPHERE_RADIUS * 0.3, -SPHERE_RADIUS * 1.4, SPHERE_RADIUS * 0.4);
		g.fill({ color: 0xffffff, alpha: 0.5 });
		return g;
	}
}

export function interpolatePolyline(
	points: { x: number; y: number }[],
	t: number,
): { x: number; y: number } {
	if (points.length === 0) return { x: 0, y: 0 };
	if (t <= 0) return { ...points[0]! };
	if (t >= 1) return { ...points[points.length - 1]! };

	const lengths: number[] = [0];
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		const dx = points[i]!.x - points[i - 1]!.x;
		const dy = points[i]!.y - points[i - 1]!.y;
		total += Math.sqrt(dx * dx + dy * dy);
		lengths.push(total);
	}
	if (total === 0) return { ...points[0]! };

	const targetDist = t * total;
	for (let i = 1; i < lengths.length; i++) {
		if (targetDist <= lengths[i]!) {
			const segStart = lengths[i - 1]!;
			const segLen = lengths[i]! - segStart;
			const localT = segLen === 0 ? 0 : (targetDist - segStart) / segLen;
			const a = points[i - 1]!;
			const b = points[i]!;
			return {
				x: a.x + (b.x - a.x) * localT,
				y: a.y + (b.y - a.y) * localT,
			};
		}
	}
	return { ...points[points.length - 1]! };
}
