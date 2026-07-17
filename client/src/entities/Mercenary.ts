import { Container, Graphics } from "pixi.js";
import { GridCoord } from "@relic-hunter/shared";
import { gridToScreen } from "../math/isoGridMath";

const SPHERE_RADIUS = 12;
const MOVE_DURATION_PER_TILE_MS = 200;

/**
 * Animated on-screen token for a hunter.
 * Visual representation only — authoritative position lives in MercenaryState.
 */
export class Mercenary {
	readonly view = new Container();

	private currentScreenPos: { x: number; y: number };
	private moveQueue: GridCoord[] = [];
	private tileStartPos: { x: number; y: number } | null = null;
	private tileTargetPos: { x: number; y: number } | null = null;
	private tileProgressMs = 0;
	private onPathComplete: (() => void) | null = null;

	constructor(initialCoord: GridCoord) {
		this.currentScreenPos = gridToScreen(initialCoord);
		this.view.addChild(this.drawSphere());
		this.syncPosition();
	}

	/** True while a move animation is in progress — blocks new input */
	get isAnimating(): boolean {
		return this.tileTargetPos !== null;
	}

	/**
	 * Animate stepping through each tile in the path.
	 * Resolves once the final tile is visually reached.
	 */
	moveAlongPath(path: GridCoord[]): Promise<void> {
		return new Promise((resolve) => {
			if (path.length === 0) {
				resolve();
				return;
			}

			this.moveQueue = [...path];
			this.onPathComplete = resolve;
			this.moveToNextTile();
		});
	}

	update(deltaTime: number): void {
		if (!this.tileStartPos || !this.tileTargetPos) return;

		// Convert deltaTime (frames) into milliseconds so timing stays consistent
		this.tileProgressMs += (deltaTime / 60) * 1000;

		const time = Math.min(this.tileProgressMs / MOVE_DURATION_PER_TILE_MS, 1);
		const eased = easeInEaseOut(time);

		this.currentScreenPos = {
			x:
				this.tileStartPos.x +
				(this.tileTargetPos.x - this.tileStartPos.x) * eased,
			y:
				this.tileStartPos.y +
				(this.tileTargetPos.y - this.tileStartPos.y) * eased,
		};

		this.syncPosition();

		// Finished this tile → start the next one
		if (time >= 1) {
			this.moveToNextTile();
		}
	}

	private moveToNextTile(): void {
		const next = this.moveQueue.shift();

		if (!next) {
			// Path completely finished
			this.tileStartPos = null;
			this.tileTargetPos = null;
			this.tileProgressMs = 0;

			const cb = this.onPathComplete;
			this.onPathComplete = null;
			cb?.();
			return;
		}

		// Begin moving toward the next tile
		this.tileStartPos = { ...this.currentScreenPos };
		this.tileTargetPos = gridToScreen(next);
		this.tileProgressMs = 0;
	}

	private syncPosition(): void {
		this.view.x = this.currentScreenPos.x;
		this.view.y = this.currentScreenPos.y;
	}

	/** Simple fake-3D sphere for testing */
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
 * Quadratic ease-in-out.
 * Starts slow, accelerates through the middle, then decelerates at the end.
 */
function easeInEaseOut(time: number): number {
	if (time < 0.5) {
		return 2 * time ** 2;
	} else {
		const remaining = 1 - time;
		return 1 - 2 * remaining ** 2;
	}
}
