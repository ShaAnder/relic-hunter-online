import { Container, Graphics } from "pixi.js";
import type { Grid, GridCoord, MovementRangeEntry } from "@relic-hunter/shared";
import {
	computeMovementRange,
	getPathTo,
	findNearestReachableTile,
	coordKey,
} from "@relic-hunter/shared";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "../math/isoGridMath";
import type { Camera } from "../core/Camera";
import type { Mercenary } from "../entities/Mercenary";

interface MoveControllerOptions {
	grid: Grid;
	camera: Camera;
	mercenary: Mercenary;
	getMercenaryCoord: () => GridCoord;
	getMovementRemaining: () => number;
	onMoveCommitted: (target: GridCoord, path: GridCoord[]) => void;
}

/**
 * Owns the entire "Move Mode" state machine:
 * - entering / exiting move mode
 * - computing + rendering movement range
 * - path preview + clamping when hovering outside range
 * - committing the move
 *
 * DungeonScene only decides *when* to enter/exit and reacts to a committed move.
 */
export class MoveController {
	readonly view = new Container(); // holds range + path preview

	private rangeContainer = new Container();
	private pathContainer = new Container();

	private isActive = false;
	private movementRange: Map<string, MovementRangeEntry> | null = null;
	private previewTarget: GridCoord | null = null;
	private previewPath: GridCoord[] = [];

	constructor(private options: MoveControllerOptions) {
		this.view.addChild(this.rangeContainer);
		this.view.addChild(this.pathContainer);
	}

	get active(): boolean {
		return this.isActive;
	}

	/** Call when the player presses the Move button */
	enter(): void {
		if (this.isActive) return;
		if (this.options.mercenary.isAnimating) return;
		if (this.options.getMovementRemaining() <= 0) return;

		this.isActive = true;

		// Lock camera on the hunter while aiming
		this.options.camera.lockTo(gridToScreen(this.options.getMercenaryCoord()));

		this.movementRange = computeMovementRange(
			this.options.grid,
			this.options.getMercenaryCoord(),
			this.options.getMovementRemaining(),
		);

		this.renderRange();
	}

	/** Cancel move mode (Escape or pressing Move again) */
	exit(): void {
		if (!this.isActive) return;

		this.isActive = false;
		this.movementRange = null;
		this.previewTarget = null;
		this.previewPath = [];

		this.rangeContainer.removeChildren();
		this.pathContainer.removeChildren();

		this.options.camera.unlock();
	}

	/** Called every mouse move while move mode is active */
	onHover(hovered: GridCoord): void {
		if (!this.isActive || !this.movementRange) return;

		// Clamp to nearest reachable tile when outside the range
		const target = this.movementRange.has(coordKey(hovered))
			? hovered
			: findNearestReachableTile(this.movementRange, hovered);

		if (!target) {
			this.clearPreview();
			return;
		}

		const path = getPathTo(this.movementRange, target) ?? [];
		this.previewTarget = target;
		this.previewPath = path;
		this.renderPathPreview(this.options.getMercenaryCoord(), path);
	}

	/** Called on click while move mode is active */
	tryCommit(): boolean {
		if (!this.isActive) return false;
		if (this.options.mercenary.isAnimating) return false;
		if (!this.previewTarget || this.previewPath.length === 0) return false;

		// Hand the final decision back to the scene
		this.options.onMoveCommitted(this.previewTarget, this.previewPath);
		return true;
	}

	// ---------- private rendering ----------

	private renderRange(): void {
		this.rangeContainer.removeChildren();
		if (!this.movementRange) return;

		for (const entry of this.movementRange.values()) {
			if (entry.distance === 0) continue;

			const pos = gridToScreen(entry.coord);
			const g = new Graphics();
			g.poly([
				0,
				-TILE_HEIGHT / 2,
				TILE_WIDTH / 2,
				0,
				0,
				TILE_HEIGHT / 2,
				-TILE_WIDTH / 2,
				0,
			]);
			g.fill({ color: 0x4a9eff, alpha: 0.35 });
			g.x = pos.x;
			g.y = pos.y;
			this.rangeContainer.addChild(g);
		}
	}

	private renderPathPreview(from: GridCoord, path: GridCoord[]): void {
		this.pathContainer.removeChildren();
		if (path.length === 0) return;

		const points = [from, ...path].map(gridToScreen);

		const line = new Graphics();
		line.moveTo(points[0].x, points[0].y);
		for (let i = 1; i < points.length; i++) {
			line.lineTo(points[i].x, points[i].y);
		}
		line.stroke({
			width: 4,
			color: 0x000000,
			alpha: 0.85,
			cap: "round",
			join: "round",
		});
		this.pathContainer.addChild(line);

		for (let i = 1; i < points.length; i++) {
			const isDest = i === points.length - 1;
			const joint = new Graphics();
			joint.circle(0, 0, isDest ? 6 : 4);
			joint.fill(isDest ? 0xffffff : 0x000000);
			if (isDest) joint.stroke({ width: 2, color: 0x000000 });
			joint.x = points[i].x;
			joint.y = points[i].y;
			this.pathContainer.addChild(joint);
		}
	}

	private clearPreview(): void {
		this.pathContainer.removeChildren();
		this.previewTarget = null;
		this.previewPath = [];
	}
}
