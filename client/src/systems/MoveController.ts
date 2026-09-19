import { Container, Graphics } from "pixi.js";
import type {
	CompiledEdgeMap,
	GridCoord,
	MovementRangeEntry,
	TerrainTraversalContext,
} from "@relic-hunter/shared";
import {
	computeMovementRangeWithEdges,
	computePathMovementCost,
	coordKey,
	getEdgeBetween,
	getTraversalStepCost,
} from "@relic-hunter/shared";
import {
	gridToScreenElevated,
	TILE_WIDTH,
	TILE_HEIGHT,
} from "@/math/isoGridMath";
import type { CameraController } from "@/core/cameras/CameraController";
import type { Mercenary } from "@/entities/Mercenary";

interface MoveControllerOptions {
	camera: CameraController;
	mercenary: Mercenary;

	getMercenaryCoord: () => GridCoord;
	getMovementRemaining: () => number;
	getBlockedCoords: () => GridCoord[];

	getFloorMap: () => CompiledEdgeMap;

	onMoveCommitted: (
		target: GridCoord,
		path: GridCoord[],
		ignoresZoc: boolean,
	) => void;
}

/**
 * idle → aiming (enter)
 * aiming → dragging (pointer down) | lock via click-seed
 * dragging → previewLocked on pointer up (if path non-empty)
 * previewLocked → commit only when primary hits path[path.length - 1]
 *               → replace path when primary hits another in-range tile
 *               → drag again replaces path
 * right-click → clear to aiming (never full exit)
 */
export type MovePhase = "idle" | "aiming" | "dragging" | "previewLocked";

/**
 * Drag-or-click to author a path; walk only when the locked destination
 * tile is clicked again.
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
	/** Steps after the unit's current tile. Dest = path[path.length - 1]. */
	private path: GridCoord[] = [];
	private budget = 0;
	private blocked = new Set<string>();

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

	get isDragging(): boolean {
		return this.phase === "dragging";
	}

	get isPreviewLocked(): boolean {
		return this.phase === "previewLocked";
	}

	/** Locked destination, or null. */
	get lockedDest(): GridCoord | null {
		if (this.path.length === 0) return null;
		return this.path[this.path.length - 1];
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
		this.path = [];
		this.budget =
			budgetOverride !== undefined
				? budgetOverride
				: this.options.getMovementRemaining();

		this.options.camera.lockTo({
			x: this.options.mercenary.view.x,
			y: this.options.mercenary.view.y,
		});

		this.blocked = new Set(this.options.getBlockedCoords().map(coordKey));
		this.rebuildRangeFromUnit();
		this.clearPreview();
	}

	exit(): void {
		if (this.pendingEnterTimeout !== null) {
			window.clearTimeout(this.pendingEnterTimeout);
			this.pendingEnterTimeout = null;
		}
		if (this.phase === "idle") return;

		this.phase = "idle";
		this.movementRange = null;
		this.path = [];
		this.rangeContainer.removeChildren();
		this.pathContainer.removeChildren();
		this.highlightContainer.removeChildren();
		this.options.camera.unlock();
	}

	/**
	 * Pointer down:
	 * - previewLocked + click dest → commit
	 * - previewLocked + other in-range → replace lock
	 * - aiming + unit/in-range → start drag (or seed lock on simple click via up)
	 */
	onPointerDown(tile: GridCoord): void {
		if (this.options.mercenary.isAnimating) return;
		if (!this.movementRange) return;

		// --- locked: confirm only on destination ---
		if (this.phase === "previewLocked") {
			const dest = this.lockedDest;
			if (dest && tile.x === dest.x && tile.y === dest.y) {
				this.commitPending();
				return;
			}
			// Other in-range tile → start a new path from here (seed + drag)
			if (this.isInFullRange(tile)) {
				this.seedPathTo(tile);
				this.phase = "dragging";
				this.refreshRangeFromTip();
				this.renderPathPreview();
			}
			return;
		}

		if (this.phase !== "aiming") return;

		const start = this.options.getMercenaryCoord();
		this.path = [];

		if (tile.x === start.x && tile.y === start.y) {
			this.phase = "dragging";
			this.clearPreview();
			return;
		}

		if (!this.isInFullRange(tile)) return;
		this.seedPathTo(tile);
		this.phase = "dragging";
		this.refreshRangeFromTip();
		this.renderPathPreview();
	}

	onPointerMove(tile: GridCoord): void {
		if (this.phase !== "dragging") return;

		const start = this.options.getMercenaryCoord();
		const last = this.path.length > 0 ? this.path[this.path.length - 1] : start;

		if (tile.x === last.x && tile.y === last.y) return;

		if (tile.x === start.x && tile.y === start.y) {
			this.path = [];
			this.refreshRangeFromTip();
			this.renderPathPreview();
			return;
		}

		const existing = this.path.findIndex(
			(c) => c.x === tile.x && c.y === tile.y,
		);
		if (existing !== -1) {
			this.path = this.path.slice(0, existing + 1);
			this.refreshRangeFromTip();
			this.renderPathPreview();
			return;
		}

		if (!this.isCardinalAdjacent(last, tile)) return;
		if (!this.canStep(last, tile)) return;
		if (this.blocked.has(coordKey(tile))) return;

		/**
		 * Stage D:
		 * validate the cost of THIS dragged route.
		 *
		 * The destination being reachable by some cheaper route is not enough.
		 */
		const candidatePath = [...this.path, tile];

		const candidateCost = this.computeExactPathCost(candidatePath);

		if (candidateCost === null || candidateCost > this.budget) {
			return;
		}

		this.path.push(tile);
		this.refreshRangeFromTip();
		this.renderPathPreview();
	}

	/**
	 * Release: lock path if non-empty. Does not walk.
	 */
	onPointerUp(): boolean {
		if (this.phase !== "dragging") return false;

		if (this.path.length === 0) {
			this.phase = "aiming";
			this.rebuildRangeFromUnit();
			this.clearPreview();
			return false;
		}

		this.phase = "previewLocked";
		this.refreshRangeFromTip();
		this.renderPathPreview();
		return true;
	}

	/**
	 * Left-click confirm helper (MapScene click path).
	 * Only commits when tile is the locked destination.
	 */
	onPrimary(tile: GridCoord): boolean {
		if (this.phase !== "previewLocked") return false;
		const dest = this.lockedDest;
		if (!dest || tile.x !== dest.x || tile.y !== dest.y) return false;
		return this.commitPending();
	}

	confirm(): boolean {
		return this.commitPending();
	}

	/**
	 * Right-click: clear path, stay aiming. Never full exit.
	 */
	onCancel(): boolean {
		if (this.phase === "previewLocked" || this.phase === "dragging") {
			this.phase = "aiming";
			this.path = [];
			this.rebuildRangeFromUnit();
			this.clearPreview();
			return true;
		}
		return false;
	}

	onHover(_hovered: GridCoord): void {}

	tryCommit(tile: GridCoord): boolean {
		return this.onPrimary(tile);
	}

	// ---------- internals ----------

	private getFloor(): CompiledEdgeMap {
		return this.options.getFloorMap();
	}

	private getTerrainContext(): TerrainTraversalContext {
		const floor = this.getFloor();

		return {
			elevationSteps: floor.elevationSteps,
			tileCodes: floor.tileCodes,
		};
	}

	/**
	 * Cost of THIS exact authored route from the unit's current tile.
	 */
	private computeExactPathCost(path: GridCoord[]): number | null {
		const floor = this.getFloor();

		return computePathMovementCost(
			this.options.getMercenaryCoord(),
			path,
			floor.edges,
			this.getTerrainContext(),
		);
	}

	private computeRange(
		from: GridCoord,
		budget: number,
	): Map<string, MovementRangeEntry> {
		const floor = this.getFloor();

		return computeMovementRangeWithEdges(
			floor.grid,
			floor.edges,
			from,
			budget,
			this.blocked,
			this.getTerrainContext(),
		);
	}

	/** Authoritative terrain + edge legality for one step. */
	private canStep(from: GridCoord, to: GridCoord): boolean {
		const floor = this.getFloor();

		if (!floor.grid.isWalkable(to)) {
			return false;
		}

		return (
			getTraversalStepCost(
				from,
				to,
				getEdgeBetween(floor.edges, from, to),
				this.getTerrainContext(),
			) !== null
		);
	}

	private commitPending(): boolean {
		if (this.phase !== "previewLocked" || this.path.length === 0) {
			return false;
		}
		if (this.options.mercenary.isAnimating) {
			return false;
		}
		/**
		 * Defensive final validation of the exact authored route.
		 */
		const actualCost = this.computeExactPathCost(this.path);
		if (actualCost === null || actualCost > this.budget) {
			return false;
		}
		const path = [...this.path];
		const target = path[path.length - 1];
		this.options.onMoveCommitted(target, path, this.currentIgnoresZoc);
		this.exit();
		return true;
	}

	private seedPathTo(tile: GridCoord): void {
		const fromUnit = this.computeRange(
			this.options.getMercenaryCoord(),
			this.budget,
		);
		const seeded = this.pathFromRangeMap(fromUnit, tile);
		this.path = seeded ?? [];
	}

	/** True if tile is reachable from unit with full budget (original footprint). */
	private isInFullRange(tile: GridCoord): boolean {
		const start = this.options.getMercenaryCoord();
		if (tile.x === start.x && tile.y === start.y) return true;
		const full = this.computeRange(start, this.budget);
		return full.has(coordKey(tile));
	}

	private rebuildRangeFromUnit(): void {
		this.movementRange = this.computeRange(
			this.options.getMercenaryCoord(),
			this.budget,
		);
		this.renderRange();
	}

	private refreshRangeFromTip(): void {
		const start = this.options.getMercenaryCoord();
		const tip = this.path.length > 0 ? this.path[this.path.length - 1] : start;
		const spent = this.computeExactPathCost(this.path);
		const remaining = spent === null ? 0 : Math.max(0, this.budget - spent);
		this.movementRange = this.computeRange(tip, remaining);
		this.renderRange();
	}

	private isCardinalAdjacent(a: GridCoord, b: GridCoord): boolean {
		return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
	}

	private pathFromRangeMap(
		range: Map<string, MovementRangeEntry>,
		destination: GridCoord,
	): GridCoord[] | null {
		const destEntry = range.get(coordKey(destination));
		if (!destEntry) return null;
		const path: GridCoord[] = [];
		let current: MovementRangeEntry | undefined = destEntry;
		while (current && current.cameFrom !== null) {
			path.push(current.coord);
			current = range.get(coordKey(current.cameFrom));
		}
		return path.reverse();
	}

	private renderRange(): void {
		this.rangeContainer.removeChildren();
		if (!this.movementRange) return;

		for (const entry of this.movementRange.values()) {
			if (entry.distance === 0) continue;
			const pos = gridToScreenElevated(entry.coord, this.getFloor().elevation);
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

	private renderPathPreview(): void {
		this.pathContainer.removeChildren();
		this.highlightContainer.removeChildren();

		const from = this.options.getMercenaryCoord();
		if (this.path.length === 0) return;

		const elevation = this.getFloor().elevation;

		const points = [from, ...this.path].map((coord) =>
			gridToScreenElevated(coord, elevation),
		);
		const locked = this.phase === "previewLocked";

		const line = new Graphics();
		line.moveTo(points[0].x, points[0].y);
		for (let i = 1; i < points.length; i++) {
			line.lineTo(points[i].x, points[i].y);
		}
		line.stroke({
			width: locked ? 5 : 4,
			color: locked ? 0xffd700 : 0xf39c12,
			alpha: 0.9,
			cap: "round",
			join: "round",
		});
		this.pathContainer.addChild(line);

		for (let i = 1; i < points.length; i++) {
			const isDest = i === points.length - 1;
			const joint = new Graphics();
			joint.circle(0, 0, isDest ? 7 : 4);
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
		glow.fill({ color: 0xffd700, alpha: locked ? 0.7 : 0.45 });
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
