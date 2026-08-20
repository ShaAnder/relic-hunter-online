import { Container, Graphics } from "pixi.js";
import type { Grid, GridCoord, MovementRangeEntry } from "@relic-hunter/shared";
import {
	computeMovementRange,
	getPathTo,
	findNearestReachableTile,
	coordKey,
} from "@relic-hunter/shared";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import type { Camera } from "@/core/cameras/Camera";
import type { Mercenary } from "@/entities/Mercenary";

interface MoveControllerOptions {
	grid: Grid;
	camera: Camera;
	mercenary: Mercenary;
	getMercenaryCoord: () => GridCoord;
	getMovementRemaining: () => number;
	getBlockedCoords: () => GridCoord[];
	onMoveCommitted: (
		target: GridCoord,
		path: GridCoord[],
		ignoresZoc: boolean,
	) => void;
}

/** Move aiming phases — drag later only edits pending, never a second pipeline. */
export type MovePhase = "idle" | "aiming" | "previewLocked";

export interface PathIntent {
	target: GridCoord;
	/** Steps after the unit's current tile (getPathTo shape). */
	path: GridCoord[];
	/** Future: player-forced detours. Empty in this draft. */
	waypoints: GridCoord[];
}

/**
 * Move mode state machine.
 *
 * idle → aiming (enter): hover previews path
 * aiming → previewLocked (primary on legal tile): path frozen
 * previewLocked → commit (primary again / confirm) or aiming (cancel)
 *
 * Drag (later) only rebuilds pending while aiming / locked — same commit path.
 *
 * @author ShaAnder
 */
export class MoveController {
	readonly view = new Container();

	private rangeContainer = new Container();
	private pathContainer = new Container();
	private highlightContainer = new Container();

	private phase: MovePhase = "idle";
	private movementRange: Map<string, MovementRangeEntry> | null = null;
	private pending: PathIntent | null = null;

	private pendingEnterTimeout: number | null = null;
	private readonly ENTER_DELAY_MS = 180;

	private currentIgnoresZoc = false;

	constructor(private options: MoveControllerOptions) {
		this.view.addChild(this.rangeContainer);
		this.view.addChild(this.pathContainer);
		this.view.addChild(this.highlightContainer);
	}

	get active(): boolean {
		return this.phase !== "idle";
	}

	get movePhase(): MovePhase {
		return this.phase;
	}

	requestEnter(): void {
		if (this.pendingEnterTimeout !== null) return;

		this.pendingEnterTimeout = window.setTimeout(() => {
			this.pendingEnterTimeout = null;
			this.enter();
		}, this.ENTER_DELAY_MS);
	}

	enter(budgetOverride?: number, ignoresZoc: boolean = false): void {
		if (this.pendingEnterTimeout !== null) {
			window.clearTimeout(this.pendingEnterTimeout);
			this.pendingEnterTimeout = null;
		}

		this.currentIgnoresZoc = ignoresZoc;
		this.phase = "aiming";
		this.pending = null;

		const budget =
			budgetOverride !== undefined
				? budgetOverride
				: this.options.getMovementRemaining();

		this.options.camera.lockTo(gridToScreen(this.options.getMercenaryCoord()));

		const blocked = new Set(this.options.getBlockedCoords().map(coordKey));

		this.movementRange = computeMovementRange(
			this.options.grid,
			this.options.getMercenaryCoord(),
			budget,
			blocked,
		);

		this.clearPreview();
		this.renderRange();
	}

	exit(): void {
		if (this.pendingEnterTimeout !== null) {
			window.clearTimeout(this.pendingEnterTimeout);
			this.pendingEnterTimeout = null;
		}
		if (this.phase === "idle") return;

		this.phase = "idle";
		this.movementRange = null;
		this.pending = null;

		this.rangeContainer.removeChildren();
		this.pathContainer.removeChildren();
		this.highlightContainer.removeChildren();

		this.options.camera.unlock();
	}

	/**
	 * Hover preview — only while aiming. Locked preview stays put.
	 */
	onHover(hovered: GridCoord): void {
		if (this.phase !== "aiming" || !this.movementRange) return;

		const intent = this.buildIntentToward(hovered);
		if (!intent) {
			this.clearPreview();
			return;
		}

		this.pending = intent;
		this.renderPathPreview(this.options.getMercenaryCoord(), intent.path);
	}

	/**
	 * Primary click (left).
	 * aiming + legal → lock preview
	 * previewLocked + click → confirm commit
	 */
	onPrimary(clickedTile: GridCoord): boolean {
		if (this.phase === "idle") return false;
		if (this.options.mercenary.isAnimating) return false;
		if (!this.movementRange) return false;

		if (this.phase === "aiming") {
			const intent = this.buildIntentToward(clickedTile);
			if (!intent || intent.path.length === 0) return false;

			this.pending = intent;
			this.phase = "previewLocked";
			this.renderPathPreview(this.options.getMercenaryCoord(), intent.path);
			return true;
		}

		// previewLocked — second click confirms current pending path
		return this.commitPending();
	}

	/**
	 * Cancel locked preview back to aiming (right-click).
	 * Returns true if it handled the cancel.
	 */
	onCancel(): boolean {
		if (this.phase === "previewLocked") {
			this.phase = "aiming";
			this.pending = null;
			this.clearPreview();
			return true;
		}
		if (this.phase === "aiming") {
			this.exit();
			return true;
		}
		return false;
	}

	/** Explicit confirm (Enter) while preview is locked. */
	confirm(): boolean {
		return this.commitPending();
	}

	/** @deprecated use onPrimary — kept so old MapScene call sites compile briefly */
	tryCommit(clickedTile: GridCoord): boolean {
		return this.onPrimary(clickedTile);
	}

	// ---------- internals ----------

	private buildIntentToward(hovered: GridCoord): PathIntent | null {
		if (!this.movementRange) return null;

		const blocked = new Set(this.options.getBlockedCoords().map(coordKey));

		const target = this.movementRange.has(coordKey(hovered))
			? hovered
			: findNearestReachableTile(
					this.options.grid,
					this.movementRange,
					hovered,
					blocked,
				);

		if (!target) return null;

		const path = getPathTo(this.movementRange, target) ?? [];
		if (path.length === 0) return null;

		return { target, path, waypoints: [] };
	}

	private commitPending(): boolean {
		if (this.phase !== "previewLocked" || !this.pending) return false;
		if (this.pending.path.length === 0) return false;
		if (this.options.mercenary.isAnimating) return false;

		const { target, path } = this.pending;
		this.options.onMoveCommitted(target, path, this.currentIgnoresZoc);
		this.exit();
		return true;
	}

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
		this.highlightContainer.removeChildren();

		if (path.length === 0) return;

		const points = [from, ...path].map(gridToScreen);

		const line = new Graphics();
		line.moveTo(points[0].x, points[0].y);
		for (let i = 1; i < points.length; i++) {
			line.lineTo(points[i].x, points[i].y);
		}
		line.stroke({
			width: 3,
			color: this.phase === "previewLocked" ? 0xffd700 : 0x000000,
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
		glow.fill({
			color: this.phase === "previewLocked" ? 0xffd700 : 0x7ec8ff,
			alpha: 0.65,
		});
		glow.stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
		glow.x = dest.x;
		glow.y = dest.y;
		this.highlightContainer.addChild(glow);
	}

	private clearPreview(): void {
		this.pathContainer.removeChildren();
		this.highlightContainer.removeChildren();
	}
}
