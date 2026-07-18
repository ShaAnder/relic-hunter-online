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
	/** Returns the mercenary's current logical grid position. */
	getMercenaryCoord: () => GridCoord;
	/** Returns the movement budget remaining this turn. */
	getMovementRemaining: () => number;
	/** Called when the player commits a move; scene applies it. */
	onMoveCommitted: (target: GridCoord, path: GridCoord[]) => void;
}

/**
 * Owns the "Move Mode" state machine: entering/exiting, movement range,
 * path preview with clamping, the bright destination glow, and committing
 * the move. BattleScene decides when to enter/exit and reacts to commits.
 *
 * The camera lock lifecycle is driven by the scene's update() since it
 * knows about the move animation — enter() only does the initial lock so
 * aiming starts centered.
 */
export class MoveController {
	readonly view = new Container();

	// Render layers, bottom to top
	private rangeContainer = new Container();
	private pathContainer = new Container();
	private highlightContainer = new Container();

	// Aiming state
	private isActive = false;
	private movementRange: Map<string, MovementRangeEntry> | null = null;
	private previewTarget: GridCoord | null = null;
	private previewPath: GridCoord[] = [];

	constructor(private options: MoveControllerOptions) {
		this.view.addChild(this.rangeContainer);
		this.view.addChild(this.pathContainer);
		this.view.addChild(this.highlightContainer);
	}

	/** Whether move mode is currently engaged. */
	get active(): boolean {
		return this.isActive;
	}

	/**
	 * Engage move mode.
	 * Refuses while animating or with no movement budget. The turn gate
	 * (AP, press count, lockout) is the scene's job via beginMovement —
	 * this controller only owns the aiming state machine.
	 */
	enter(): void {
		if (this.isActive) return;
		if (this.options.mercenary.isAnimating) return;
		if (this.options.getMovementRemaining() <= 0) return;

		this.isActive = true;

		// Initial lock so aiming starts centered on the hunter
		this.options.camera.lockTo(gridToScreen(this.options.getMercenaryCoord()));

		this.movementRange = computeMovementRange(
			this.options.grid,
			this.options.getMercenaryCoord(),
			this.options.getMovementRemaining(),
		);

		this.renderRange();
	}

	/** Cancel move mode and clear all aiming visuals. */
	exit(): void {
		if (!this.isActive) return;

		this.isActive = false;
		this.movementRange = null;
		this.previewTarget = null;
		this.previewPath = [];

		this.rangeContainer.removeChildren();
		this.pathContainer.removeChildren();
		this.highlightContainer.removeChildren();

		// Covers plain cancels; on a commit the scene re-locks next frame
		// because the mercenary is animating.
		this.options.camera.unlock();
	}

	/**
	 * Update the path preview for the hovered tile.
	 * Hovers outside the range clamp to the nearest reachable tile.
	 */
	onHover(hovered: GridCoord): void {
		if (!this.isActive || !this.movementRange) return;

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

	/** Commit the previewed move; returns false if nothing valid to commit. */
	tryCommit(): boolean {
		if (!this.isActive) return false;
		if (this.options.mercenary.isAnimating) return false;
		if (!this.previewTarget || this.previewPath.length === 0) return false;

		this.options.onMoveCommitted(this.previewTarget, this.previewPath);
		return true;
	}

	// ---------- private rendering ----------

	/** Fill every reachable tile with the range tint. */
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

	/** Draw the path line, joints, and the destination glow. */
	private renderPathPreview(from: GridCoord, path: GridCoord[]): void {
		this.pathContainer.removeChildren();
		this.highlightContainer.removeChildren();
		if (path.length === 0) return;

		const points = [from, ...path].map(gridToScreen);

		// Path line
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

		// Joints along the path, larger white dot on the destination
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

		// Destination glow — matters most when the hover is clamped, since
		// this tile (not the cursor) is where the hunter will land
		const dest = points[points.length - 1];
		const glow = new Graphics();
		glow.poly([
			0,
			-TILE_HEIGHT / 2,
			TILE_WIDTH / 2,
			0,
			0,
			TILE_HEIGHT / 2,
			-TILE_WIDTH / 2,
			0,
		]);
		glow.fill({ color: 0x7ec8ff, alpha: 0.65 });
		glow.stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
		glow.x = dest.x;
		glow.y = dest.y;
		this.highlightContainer.addChild(glow);
	}

	/** Clear the preview visuals without leaving move mode. */
	private clearPreview(): void {
		this.pathContainer.removeChildren();
		this.highlightContainer.removeChildren();
		this.previewTarget = null;
		this.previewPath = [];
	}
}
