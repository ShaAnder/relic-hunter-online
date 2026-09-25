import { Container, Graphics } from "pixi.js";
import {
	resolveTileMaterial,
	type ResolvedTileMaterial,
} from "./engine/materials/mapMaterialFactory";
import {
	resolveBarrierMaterial,
	type ResolvedBarrierMaterial,
} from "./engine/materials/barrierMaterialFactory";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import * as RH from "@relic-hunter/shared";
import { fillForTileCode } from "./tileFills";
import { WORLD_DEPTH_BIAS } from "./worldDepth";
import {
	barrierRenderProfileFor,
	connectorPriorityFor,
	type BarrierRenderProfile,
} from "./barrierRenderProfile";
import {
	addBarrierQuadOverlay,
	addBarrierQuadSurface,
	type BarrierSurfaceQuad,
} from "./barrierQuadSurface";
import { perf } from "@/perf/PerfMonitor";

/** How much larger than its true footprint each ordinary tile is drawn. */
const TILE_OVERSIZE = 1.09;
/** One normal full-height barrier storey in projected pixels. */
const WALL_HEIGHT_PX = TILE_HEIGHT;
/** How short a room's own boundary barriers become while the player is inside it. */
const FOCUSED_WALL_HEIGHT_FRACTION = 0.2;
/** Shared wash used by room focus and explored fog. */
const WASH_COLOR = 0x14141e;
const WASH_ALPHA = 0.72;

const FLOOR_COLOR = 0xc8c8c8;
const TERRAIN_SIDE_COLOR = 0x4a4652;

type ScreenPoint = { x: number; y: number };

type DrawableLayer = "ground" | "world";

interface Drawable {
	layer: DrawableLayer;
	depth: number;
	draw: () => Container;
}

interface MapMaterialRenderContext {
	mapSeed: number;
	floorIndex: number;
}

interface MapRendererBuildOptions {
	renderGround?: boolean;
	renderWorld?: boolean;
}

/**
 * What a piece of the map should draw as, combining room-focus and
 * fog-of-war into one answer instead of two separately-applied effects.
 *
 * "hidden" wins over everything.
 */
type VisualState = "hidden" | "washed" | "normal";

/**
 * Full resolved geometry for one barrier segment spanning one
 * StructuralEdgeRef.
 *
 * The topology stays shared/gameplay-owned; this object is purely the
 * projected render geometry consumed by the presentation layer.
 */
interface BarrierSegmentSkeleton {
	startVertex: RH.GridVertex;
	endVertex: RH.GridVertex;

	centerBase1: ScreenPoint;
	centerBase2: ScreenPoint;

	foundationCenter1: ScreenPoint;
	foundationCenter2: ScreenPoint;

	nearBase1: ScreenPoint;
	nearBase2: ScreenPoint;
	farBase1: ScreenPoint;
	farBase2: ScreenPoint;

	nearTop1: ScreenPoint;
	nearTop2: ScreenPoint;
	farTop1: ScreenPoint;
	farTop2: ScreenPoint;

	foundationNear1: ScreenPoint;
	foundationNear2: ScreenPoint;
	foundationFar1: ScreenPoint;
	foundationFar2: ScreenPoint;

	hasFoundation: boolean;
	depth: number;
}

/**
 * Renders an edge-based map (Grid + EdgeGrid, from compileEdgeMap).
 *
 * Room-focus and fog-of-war are both applied at build time, not as
 * later per-object alpha tweaks
 *
 * Barrier segment/connector geometry goes through the canonical
 * wall-topology resolver.
 */
export class MapRenderer {
	private ownedWorldViews: Container[] = [];

	constructor(
		private groundContainer: Container,
		private worldDepthContainer: Container = groundContainer,
	) {
		this.groundContainer.sortableChildren = true;
		this.worldDepthContainer.sortableChildren = true;
	}

	private clearOwnedWorldViews(): void {
		for (const view of this.ownedWorldViews) {
			if (view.parent === this.worldDepthContainer) {
				this.worldDepthContainer.removeChild(view);
			}

			view.destroy({ children: true });
		}

		this.ownedWorldViews = [];
	}

	private clearForRebuild(): void {
		/**
		 * The active-floor renderer uses two containers
		 * groundContainer
		 *     -> tile tops
		 *
		 * worldDepthContainer
		 *     -> terrain faces / walls / entities
		 * The lower-floor renderer still uses a single container for both.
		 * In that case we must clear it only once.
		 */
		if (this.groundContainer === this.worldDepthContainer) {
			for (const child of this.groundContainer.removeChildren()) {
				child.destroy({ children: true });
			}

			this.ownedWorldViews = [];
			return;
		}
		/**
		 * Active floor:
		 *
		 * groundContainer is fully owned by MapRenderer, so every child
		 * can be removed.
		 */
		for (const child of this.groundContainer.removeChildren()) {
			child.destroy({ children: true });
		}
		/**
		 * worldDepthContainer is shared with hunters, monsters and chests,
		 * so only remove Graphics created by this MapRenderer.
		 */
		this.clearOwnedWorldViews();
	}

	/**
	 * Remove only visual resources owned by the legacy map renderer.
	 *
	 * The active world-depth container is shared with actors and the Reactor
	 * renderer, so this deliberately removes only MapRenderer-owned world views.
	 *
	 * Phase 3 uses this when switching rendering ownership from legacy MapRenderer
	 * to Reactor without performing another legacy rebuild.
	 */
	clear(): void {
		this.clearForRebuild();

		perf.setCounter(
			"renderer.groundChildren",
			this.groundContainer.children.length,
		);

		perf.setCounter("renderer.legacyWorldViews", this.ownedWorldViews.length);
	}

	/**
	 * @param focusRoom When set, this room's own boundary walls draw
	 * visually shorter
	 * @param fog When set, applies real fog-of-war on top of
	 * everything else: an unseen tile/wall isn't drawn at all
	 * fogOfWarEnabled toggle).
	 * @param forceWashed When true, renders the whole floor with the
	 * dark washed treatment regardless of fog/room-focus
	 * @param wallHeightScale Scales every wall's height - 1 for the
	 * active floor, smaller for a decorative underlay.
	 */
	build(
		compiled: RH.CompiledEdgeMap,
		focusRoom: RH.Room | null = null,
		fog: {
			state: RH.HasFogOfWar;
			center: RH.GridCoord;
			turn: number;
		} | null = null,
		forceWashed = false,
		wallHeightScale = 1,
		materialContext?: MapMaterialRenderContext,
		options: MapRendererBuildOptions = {},
	): void {
		const endPerf = perf.start("renderer.mapBuild");

		perf.incrementCounter("renderer.fullBuilds");
		this.clearForRebuild();

		const drawables: Drawable[] = [];
		const renderWorld = options.renderWorld ?? true;
		const focusCellKeys = focusRoom
			? new Set(focusRoom.cells.map((c) => `${c.x},${c.y}`))
			: null;

		const focusBoundaryKeys = focusRoom
			? new Set(
					focusRoom.boundaryEdges.map((e) => this.edgeDedupeKey(e.a, e.b)),
				)
			: null;

		const visualStateAt = (
			coord: RH.GridCoord,
			roomFocused: boolean,
		): VisualState => {
			if (fog) {
				const visibility = RH.getTileVisibility(
					fog.state,
					coord,
					fog.center,
					fog.turn,
				);

				if (visibility === "unseen") {
					return "hidden";
				}

				if (visibility === "explored") {
					return "washed";
				}

				// "visible": fall through
			}

			// Used by the lower-floor underlay: render the whole floor with
			// the same darkened "washed" treatment used elsewhere, rather
			// than making the whole container highly transparent.
			if (forceWashed) {
				return "washed";
			}

			return roomFocused ? "washed" : "normal";
		};

		// ------------------------------------------------------------
		// TILE TOPS
		// ------------------------------------------------------------

		if (options.renderGround ?? true) {
			for (let y = 0; y < compiled.grid.height; y++) {
				for (let x = 0; x < compiled.grid.width; x++) {
					const coord: RH.GridCoord = {
						x,
						y,
					};

					const key = `${x},${y}`;
					const elevation = compiled.elevation.get(key) ?? 0;

					// Void / non-renderable tile.
					if (!Number.isFinite(elevation)) {
						continue;
					}

					const roomFocused = focusCellKeys !== null && !focusCellKeys.has(key);
					const state = visualStateAt(coord, roomFocused);

					if (state === "hidden") {
						continue;
					}

					const tileCode = compiled.tileCodes.get(key);
					const material = materialContext
						? resolveTileMaterial({
								code: tileCode,
								coord,
								compiled,
								mapSeed: materialContext.mapSeed,
								floorIndex: materialContext.floorIndex,
							})
						: undefined;

					drawables.push(
						this.tileDrawable(
							coord,
							elevation,
							state === "washed",
							fillForTileCode(tileCode),

							this.tileNeedsTrueFootprint(compiled, coord, elevation, tileCode),

							material,
						),
					);
				}
			}
		}

		// ------------------------------------------------------------
		// TERRAIN FACES
		// ------------------------------------------------------------

		// Vertical terrain faces between two horizontally/vertically
		// adjacent tiles with different elevation - the actual
		// curb/cliff skeleton for a raised or sunken tile.
		if (renderWorld) {
			const pushTerrainFace = (
				a: RH.GridCoord,
				b: RH.GridCoord,
				dir: "E" | "S",
			): void => {
				const aElevation = this.elevationAt(compiled, a);
				const bElevation = this.elevationAt(compiled, b);

				if (
					aElevation === undefined ||
					bElevation === undefined ||
					!Number.isFinite(aElevation) ||
					!Number.isFinite(bElevation) ||
					Math.abs(aElevation - bElevation) < 0.000001
				) {
					return;
				}

				if (aElevation <= bElevation + 0.000001) {
					return;
				}

				const aOutsideFocus =
					focusCellKeys !== null && !focusCellKeys.has(RH.coordKey(a));
				const bOutsideFocus =
					focusCellKeys !== null && !focusCellKeys.has(RH.coordKey(b));
				const aState = visualStateAt(a, aOutsideFocus);
				const bState = visualStateAt(b, bOutsideFocus);

				if (aState === "hidden" && bState === "hidden") {
					return;
				}

				drawables.push(
					this.terrainFaceDrawable(
						a,
						b,
						dir,
						aElevation,
						bElevation,
						aState !== "normal" && bState !== "normal",
					),
				);
			};

			for (let y = 0; y < compiled.grid.height; y++) {
				for (let x = 0; x < compiled.grid.width - 1; x++) {
					pushTerrainFace(
						{
							x,
							y,
						},
						{
							x: x + 1,
							y,
						},
						"E",
					);
				}
			}

			for (let y = 0; y < compiled.grid.height - 1; y++) {
				for (let x = 0; x < compiled.grid.width; x++) {
					pushTerrainFace(
						{
							x,
							y,
						},
						{
							x,
							y: y + 1,
						},
						"S",
					);
				}
			}

			// ------------------------------------------------------------
			// BARRIER CONNECTOR COLLECTION
			// ------------------------------------------------------------

			// Corners are keyed by real topology (vertex), not rounded screen
			// position - every wall touching the same logical vertex agrees
			// exactly, since they all resolve through the same topology
			// function.
			const STATE_RANK: Record<VisualState, number> = {
				hidden: 0,
				washed: 1,
				normal: 2,
			};

			const connectorTouches = new Map<
				string,
				{
					base: ScreenPoint;
					foundationBottomY: number;
					height: number;
					state: VisualState;
					barrier: RH.EdgeBarrier;

					/**
					 * Foreground tile tops that may visually cover this shared
					 * Fence/Glass connector.
					 */
					occluderPolygons: number[][];
				}
			>();

			const registerConnector = (
				vertex: RH.GridVertex,
				base: ScreenPoint,
				height: number,
				foundationBottomY: number,
				state: VisualState,
				barrier: RH.EdgeBarrier,
				occluderPolygon?: number[],
			): void => {
				const key = `${vertex.x},${vertex.y}`;
				const existing = connectorTouches.get(key);
				const nextHeight = Math.max(existing?.height ?? 0, height);
				const nextFoundationBottomY = Math.max(
					existing?.foundationBottomY ?? base.y,
					foundationBottomY,
				);
				const nextState: VisualState =
					!existing || STATE_RANK[state] > STATE_RANK[existing.state]
						? state
						: existing.state;
				const nextOccluderPolygons = existing
					? [...existing.occluderPolygons]
					: [];
				if (occluderPolygon) {
					nextOccluderPolygons.push(occluderPolygon);
				}

				connectorTouches.set(key, {
					// Every connected wall resolves this vertex through
					// the same topology function, so these bases should
					// agree exactly.
					base: existing?.base ?? base,
					foundationBottomY: nextFoundationBottomY,
					height: nextHeight,
					state: nextState,
					occluderPolygons: nextOccluderPolygons,
					barrier:
						!existing ||
						connectorPriorityFor(barrier) >
							connectorPriorityFor(existing.barrier)
							? barrier
							: existing.barrier,
				});
			};

			// ------------------------------------------------------------
			// EAST/WEST BARRIER SEGMENTS
			// ------------------------------------------------------------

			for (let y = 0; y < compiled.grid.height; y++) {
				for (let x = 0; x < compiled.grid.width - 1; x++) {
					const a: RH.GridCoord = {
						x,
						y,
					};

					const b: RH.GridCoord = {
						x: x + 1,
						y,
					};

					const barrier = RH.getEdgeBetween(compiled.edges, a, b);

					if (barrier === RH.EdgeBarrier.None) {
						continue;
					}

					drawables.push(
						this.barrierSegmentDrawable(
							a,
							b,
							barrier,
							compiled,
							focusBoundaryKeys,
							visualStateAt,
							wallHeightScale,
							registerConnector,
						),
					);
				}
			}

			// ------------------------------------------------------------
			// NORTH/SOUTH BARRIER SEGMENTS
			// ------------------------------------------------------------

			for (let y = 0; y < compiled.grid.height - 1; y++) {
				for (let x = 0; x < compiled.grid.width; x++) {
					const a: RH.GridCoord = {
						x,
						y,
					};

					const b: RH.GridCoord = {
						x,
						y: y + 1,
					};

					const barrier = RH.getEdgeBetween(compiled.edges, a, b);

					if (barrier === RH.EdgeBarrier.None) {
						continue;
					}

					drawables.push(
						this.barrierSegmentDrawable(
							a,
							b,
							barrier,
							compiled,
							focusBoundaryKeys,
							visualStateAt,
							wallHeightScale,
							registerConnector,
						),
					);
				}
			}

			// ------------------------------------------------------------
			// BARRIER CONNECTORS / POSTS
			// ------------------------------------------------------------

			for (const {
				base,
				foundationBottomY,
				height,
				state,
				barrier,
				occluderPolygons,
			} of connectorTouches.values()) {
				if (state === "hidden") {
					continue;
				}

				drawables.push(
					this.barrierConnectorDrawable(
						base,
						height,
						foundationBottomY,
						state === "washed",
						barrier,
						occluderPolygons,
					),
				);
			}
		}
		// ------------------------------------------------------------
		// FINAL DEPTH SORT + DRAW
		// ------------------------------------------------------------

		const groundDrawables = drawables
			.filter((d) => d.layer === "ground")
			.sort((a, b) => a.depth - b.depth);

		const worldDrawables = drawables
			.filter((d) => d.layer === "world")
			.sort((a, b) => a.depth - b.depth);

		for (const drawable of groundDrawables) {
			const graphic = drawable.draw();
			graphic.zIndex = drawable.depth;
			this.groundContainer.addChild(graphic);
		}

		for (const drawable of worldDrawables) {
			const view = drawable.draw();
			view.zIndex = drawable.depth;
			this.worldDepthContainer.addChild(view);
			this.ownedWorldViews.push(view);
		}
		perf.setCounter(
			"renderer.groundChildren",
			this.groundContainer.children.length,
		);

		perf.setCounter(
			"renderer.worldChildren",
			this.worldDepthContainer.children.length,
		);

		perf.setCounter("renderer.legacyWorldViews", this.ownedWorldViews.length);

		endPerf();
	}

	/** A direction-independent key for an edge, so a boundary edge stored as (a,b) matches the same edge encountered as (b,a) while iterating the grid the other way. */
	private edgeDedupeKey(a: RH.GridCoord, b: RH.GridCoord): string {
		const [lo, hi] =
			a.x === b.x ? (a.y < b.y ? [a, b] : [b, a]) : a.x < b.x ? [a, b] : [b, a];
		return `${lo.x},${lo.y}-${hi.x},${hi.y}`;
	}

	private trueTileCorners(coord: RH.GridCoord, elevationPx: number) {
		const base = gridToScreen(coord);
		const sy = base.y - elevationPx;
		return {
			top: { x: base.x, y: sy - TILE_HEIGHT / 2 },
			right: { x: base.x + TILE_WIDTH / 2, y: sy },
			bottom: { x: base.x, y: sy + TILE_HEIGHT / 2 },
			left: { x: base.x - TILE_WIDTH / 2, y: sy },
			center: { x: base.x, y: sy },
		};
	}

	private elevationAt(
		compiled: RH.CompiledEdgeMap,
		coord: RH.GridCoord,
	): number | undefined {
		return compiled.elevation.get(RH.coordKey(coord));
	}

	/**
	 * Screen position of a grid VERTEX (a corner point shared by up to
	 * four tiles), at a given world elevation. Grid vertices map onto
	 * tile corners as:
	 *
	 *     tile(x,y).top    = vertex(x,   y)
	 *     tile(x,y).right  = vertex(x+1, y)
	 *     tile(x,y).bottom = vertex(x+1, y+1)
	 *     tile(x,y).left   = vertex(x,   y+1)
	 */
	private vertexScreenPoint(
		vertex: RH.GridVertex,
		elevation: number,
	): ScreenPoint {
		const projected = gridToScreen({ x: vertex.x, y: vertex.y });
		return {
			x: projected.x,
			y: projected.y - TILE_HEIGHT / 2 - elevation * TILE_HEIGHT,
		};
	}

	/**
	 * Oversized coplanar tiles hide ordinary seams.
	 *
	 * At a genuine elevation boundary, however, oversizing makes the
	 * raised/lowered tile poke through the vertical side/wall.
	 * Therefore every tile touching a height change uses its TRUE
	 * footprint.
	 */
	private tileNeedsTrueFootprint(
		compiled: RH.CompiledEdgeMap,
		coord: RH.GridCoord,
		elevation: number,
		code: RH.EdgeMapTileCode | undefined,
	): boolean {
		const neighbours: RH.GridCoord[] = [
			{ x: coord.x + 1, y: coord.y },
			{ x: coord.x - 1, y: coord.y },
			{ x: coord.x, y: coord.y + 1 },
			{ x: coord.x, y: coord.y - 1 },
		];

		for (const neighbour of neighbours) {
			if (
				neighbour.x < 0 ||
				neighbour.y < 0 ||
				neighbour.x >= compiled.grid.width ||
				neighbour.y >= compiled.grid.height
			) {
				continue;
			}

			const key = RH.coordKey(neighbour);
			const otherElevation = compiled.elevation.get(key);
			const otherCode = compiled.tileCodes.get(key);

			if (
				otherElevation !== undefined &&
				Number.isFinite(otherElevation) &&
				elevation - otherElevation > 0.000001
			) {
				return true;
			}

			if (otherCode !== code) {
				return true;
			}
		}

		return false;
	}

	private tileDrawable(
		coord: RH.GridCoord,
		elevation: number,
		washed: boolean,
		fillOverride?: number,
		trueFootprint = false,
		material?: ResolvedTileMaterial,
	): Drawable {
		const elevationPx = elevation * TILE_HEIGHT;

		const trueCorners = this.trueTileCorners(coord, elevationPx);

		const tileOversize = trueFootprint ? 1 : TILE_OVERSIZE;

		const hw = (TILE_WIDTH / 2) * tileOversize;
		const hh = (TILE_HEIGHT / 2) * tileOversize;
		const c = trueCorners.center;
		const color = fillOverride ?? FLOOR_COLOR;
		const depth = trueCorners.bottom.y - 100_000; // tiles always sort behind anything standing on their own edge

		return {
			layer: "ground",
			depth,
			draw: () => {
				const g = new Graphics();
				const poly = [
					c.x,
					c.y - hh,
					c.x + hw,
					c.y,
					c.x,
					c.y + hh,
					c.x - hw,
					c.y,
				];
				g.poly(poly);

				if (material?.baseTexture) {
					g.fill({
						texture: material.baseTexture,
						textureSpace: "local",
					});
				} else {
					g.fill(color);
				}

				for (const overlay of material?.overlays ?? []) {
					g.poly(poly);

					g.fill({
						texture: overlay.texture,
						textureSpace: "local",
						alpha: overlay.alpha,
					});
				}
				if (washed) {
					g.poly(poly);
					g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
				}
				return g;
			},
		};
	}

	/**
	 * Exact top-surface polygon for one tile.
	 *
	 * This is deliberately the TRUE tile footprint, never TILE_OVERSIZE:
	 * a depth mask must stop on the authored tile boundary rather than
	 * bleeding into neighbouring geometry.
	 */
	private tileTopOcclusionPolygon(
		coord: RH.GridCoord,
		elevation: number,
	): number[] {
		const corners = this.trueTileCorners(coord, elevation * TILE_HEIGHT);

		return [
			corners.top.x,
			corners.top.y,

			corners.right.x,
			corners.right.y,

			corners.bottom.x,
			corners.bottom.y,

			corners.left.x,
			corners.left.y,
		];
	}

	/**
	 * Clips a world-depth Graphic so it cannot draw through any supplied
	 * foreground tile-top polygons.
	 *
	 * The mask itself is owned by MapRenderer and is cleaned up by the
	 * existing ownedWorldGraphics lifecycle.
	 */
	private applyInverseWorldMask(
		view: Container,
		polygons: readonly number[][],
	): void {
		if (polygons.length === 0) {
			return;
		}

		const mask = new Graphics();

		for (const polygon of polygons) {
			mask.poly(polygon);

			mask.fill(0xffffff);
		}

		/**
		 * Pixi requires a mask object to be in the display list.
		 * A mask is not normally rendered as visible content while it is
		 * serving as the view<s mask.
		 */
		this.worldDepthContainer.addChild(mask);

		this.ownedWorldViews.push(mask);

		view.setMask({
			mask,
			inverse: true,
		});
	}

	/**
	 * Vertical terrain face between two adjacent tiles at different
	 * elevations - the visible "curb" or "cliff" side of a raised or
	 * sunken tile, distinct from a wall (which is an authored barrier,
	 * not a terrain height difference).
	 */
	private terrainFaceDrawable(
		a: RH.GridCoord,
		b: RH.GridCoord,
		dir: "E" | "S",
		aElevation: number,
		bElevation: number,
		washed: boolean,
	): Drawable {
		const aCorners = this.trueTileCorners(a, aElevation * TILE_HEIGHT);
		const bCorners = this.trueTileCorners(b, bElevation * TILE_HEIGHT);

		const [a1, a2, b1, b2] =
			dir === "E"
				? [aCorners.right, aCorners.bottom, bCorners.top, bCorners.left]
				: [aCorners.bottom, aCorners.left, bCorners.right, bCorners.top];

		const face = [a1.x, a1.y, a2.x, a2.y, b2.x, b2.y, b1.x, b1.y];

		return {
			layer: "world",
			depth: Math.max(a1.y, a2.y, b1.y, b2.y) + WORLD_DEPTH_BIAS.terrainFace,

			draw: () => {
				const g = new Graphics();
				g.poly(face);
				g.fill(TERRAIN_SIDE_COLOR);
				if (washed) {
					g.poly(face);
					g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
				}
				return g;
			},
		};
	}

	private perpOffset(
		p1: ScreenPoint,
		p2: ScreenPoint,
		dist: number,
	): ScreenPoint {
		const dx = p2.x - p1.x;
		const dy = p2.y - p1.y;
		const length = Math.hypot(dx, dy);
		if (length === 0) return { x: 0, y: 0 };
		return { x: (-dy / length) * dist, y: (dx / length) * dist };
	}

	/**
	 * Resolves one structural barrier edge into projected segment
	 * geometry.
	 *
	 * Every edge touching the same GridVertex still resolves its junction
	 * through the canonical shared topology helpers, so segments agree on
	 * their physical endpoints even when their visual thickness differs.
	 */

	private buildBarrierSegmentSkeleton(
		edge: RH.StructuralEdgeRef,
		compiled: RH.CompiledEdgeMap,
		height: number,
		thicknessPx: number,
	): BarrierSegmentSkeleton {
		const [startVertex, endVertex] = RH.structuralEdgeVertices(edge);

		const startElevation = RH.resolveWallJunctionHeight(
			compiled,
			edge,
			startVertex,
		);
		const endElevation = RH.resolveWallJunctionHeight(
			compiled,
			edge,
			endVertex,
		);

		const foundationElevation =
			RH.edgeFoundationHeight(compiled, edge) ??
			Math.min(startElevation, endElevation);

		const centerBase1 = this.vertexScreenPoint(startVertex, startElevation);
		const centerBase2 = this.vertexScreenPoint(endVertex, endElevation);

		const foundationCenter1 = this.vertexScreenPoint(
			startVertex,
			foundationElevation,
		);
		const foundationCenter2 = this.vertexScreenPoint(
			endVertex,
			foundationElevation,
		);

		// Wall thickness is based on the plan-view (elevation 0) edge,
		// not the visually sloped edge - otherwise changing terrain
		// height would change apparent wall thickness.
		const raw1 = this.vertexScreenPoint(startVertex, 0);
		const raw2 = this.vertexScreenPoint(endVertex, 0);

		const off = this.perpOffset(raw1, raw2, thicknessPx);

		const nearBase1 = { x: centerBase1.x + off.x, y: centerBase1.y + off.y };
		const nearBase2 = { x: centerBase2.x + off.x, y: centerBase2.y + off.y };
		const farBase1 = { x: centerBase1.x - off.x, y: centerBase1.y - off.y };
		const farBase2 = { x: centerBase2.x - off.x, y: centerBase2.y - off.y };

		const foundationNear1 = {
			x: foundationCenter1.x + off.x,
			y: foundationCenter1.y + off.y,
		};
		const foundationNear2 = {
			x: foundationCenter2.x + off.x,
			y: foundationCenter2.y + off.y,
		};
		const foundationFar1 = {
			x: foundationCenter1.x - off.x,
			y: foundationCenter1.y - off.y,
		};
		const foundationFar2 = {
			x: foundationCenter2.x - off.x,
			y: foundationCenter2.y - off.y,
		};

		const up = (point: ScreenPoint): ScreenPoint => ({
			x: point.x,
			y: point.y - height,
		});

		return {
			startVertex,
			endVertex,
			centerBase1,
			centerBase2,
			foundationCenter1,
			foundationCenter2,
			nearBase1,
			nearBase2,
			farBase1,
			farBase2,
			nearTop1: up(nearBase1),
			nearTop2: up(nearBase2),
			farTop1: up(farBase1),
			farTop2: up(farBase2),
			foundationNear1,
			foundationNear2,
			foundationFar1,
			foundationFar2,
			hasFoundation:
				Math.abs(foundationCenter1.y - centerBase1.y) > 0.000001 ||
				Math.abs(foundationCenter2.y - centerBase2.y) > 0.000001,
			/**
			 * Sort the barrier by the architectural surface it stands on.
			 *
			 * The foundation may extend downward to meet lower terrain, but that
			 * visual skirt must not make the whole wall/fence behave as though its
			 * ground-contact point were down there.
			 */
			depth: Math.max(centerBase1.y, centerBase2.y),
		};
	}

	private barrierEdgeUv(
		edge: RH.StructuralEdgeRef,
		profile: BarrierRenderProfile,
	): readonly [number, number] {
		const edgeAxis = edge.orientation === "north" ? edge.x : edge.y;

		return [
			edgeAxis * profile.faceUvPerEdge,
			(edgeAxis + 1) * profile.faceUvPerEdge,
		];
	}

	private centerTopPoint(
		nearTop: ScreenPoint,
		farTop: ScreenPoint,
	): ScreenPoint {
		return {
			x: (nearTop.x + farTop.x) / 2,
			y: (nearTop.y + farTop.y) / 2,
		};
	}

	/**
	 * Builds one barrier segment using properties from BarrierRenderProfile.
	 *
	 * No semantic type checks live here. A solid wall, low wall, door,
	 * fence, glass panel, or future barrier reaches this method through
	 * the same geometry pipeline and differs only by profile data.
	 */
	private barrierSegmentView(
		edge: RH.StructuralEdgeRef,
		skeleton: BarrierSegmentSkeleton,
		profile: BarrierRenderProfile,
		material: ResolvedBarrierMaterial,
		state: VisualState,
	): Container {
		const view = new Container();
		const [u1, u2] = this.barrierEdgeUv(edge, profile);

		if (profile.geometryKind === "panel") {
			const top1 = this.centerTopPoint(skeleton.nearTop1, skeleton.farTop1);
			const top2 = this.centerTopPoint(skeleton.nearTop2, skeleton.farTop2);

			const bottom1 = profile.extendSegmentToFoundation
				? skeleton.foundationCenter1
				: skeleton.centerBase1;
			const bottom2 = profile.extendSegmentToFoundation
				? skeleton.foundationCenter2
				: skeleton.centerBase2;

			const face: BarrierSurfaceQuad = [top1, top2, bottom2, bottom1];

			const v1 =
				(Math.max(1, bottom1.y - top1.y) / WALL_HEIGHT_PX) *
				profile.faceUvPerStorey;
			const v2 =
				(Math.max(1, bottom2.y - top2.y) / WALL_HEIGHT_PX) *
				profile.faceUvPerStorey;

			const fallbackColor =
				edge.orientation === "north"
					? profile.segmentLeftColor
					: profile.segmentRightColor;

			addBarrierQuadSurface(
				view,
				face,
				material.segmentFaceTexture,
				fallbackColor,
				profile.segmentAlpha,
				[u1, 0, u2, 0, u2, v2, u1, v1],
			);

			if (state === "washed") {
				addBarrierQuadOverlay(view, face, WASH_COLOR, WASH_ALPHA);
			}

			return view;
		}

		/**
		 * Solid barriers are prisms around the authored structural edge.
		 * near/far are opposing long sides, so only the camera-facing side
		 * is rendered. Drawing both produces the doubled wall we were seeing.
		 */
		const nearDepth = (skeleton.nearBase1.y + skeleton.nearBase2.y) / 2;
		const farDepth = (skeleton.farBase1.y + skeleton.farBase2.y) / 2;
		const frontIsNear = nearDepth >= farDepth;

		const frontBase1 = frontIsNear ? skeleton.nearBase1 : skeleton.farBase1;
		const frontBase2 = frontIsNear ? skeleton.nearBase2 : skeleton.farBase2;
		const frontTop1 = frontIsNear ? skeleton.nearTop1 : skeleton.farTop1;
		const frontTop2 = frontIsNear ? skeleton.nearTop2 : skeleton.farTop2;
		const frontFoundation1 = frontIsNear
			? skeleton.foundationNear1
			: skeleton.foundationFar1;
		const frontFoundation2 = frontIsNear
			? skeleton.foundationNear2
			: skeleton.foundationFar2;

		const frontBottom1 =
			profile.extendSegmentToFoundation && skeleton.hasFoundation
				? frontFoundation1
				: frontBase1;
		const frontBottom2 =
			profile.extendSegmentToFoundation && skeleton.hasFoundation
				? frontFoundation2
				: frontBase2;

		const frontFace: BarrierSurfaceQuad = [
			frontTop1,
			frontTop2,
			frontBottom2,
			frontBottom1,
		];

		const frontV1 =
			(Math.max(1, frontBottom1.y - frontTop1.y) / WALL_HEIGHT_PX) *
			profile.faceUvPerStorey;
		const frontV2 =
			(Math.max(1, frontBottom2.y - frontTop2.y) / WALL_HEIGHT_PX) *
			profile.faceUvPerStorey;

		addBarrierQuadSurface(
			view,
			frontFace,
			material.segmentFaceTexture,
			frontIsNear ? profile.segmentLeftColor : profile.segmentRightColor,
			profile.segmentAlpha,
			[u1, 0, u2, 0, u2, frontV2, u1, frontV1],
		);

		if (profile.showSegmentTop) {
			const topFace: BarrierSurfaceQuad = [
				skeleton.nearTop1,
				skeleton.nearTop2,
				skeleton.farTop2,
				skeleton.farTop1,
			];

			addBarrierQuadSurface(
				view,
				topFace,
				material.segmentTopTexture,
				profile.segmentTopColor,
				profile.segmentAlpha,
				[u1, 0, u2, 0, u2, 1, u1, 1],
			);

			if (state === "washed") {
				addBarrierQuadOverlay(view, topFace, WASH_COLOR, WASH_ALPHA);
			}
		}

		if (state === "washed") {
			addBarrierQuadOverlay(view, frontFace, WASH_COLOR, WASH_ALPHA);
		}

		return view;
	}

	private barrierSegmentDrawable(
		coord: RH.GridCoord,
		other: RH.GridCoord,
		barrier: RH.EdgeBarrier,
		compiled: RH.CompiledEdgeMap,
		focusBoundaryKeys: Set<string> | null,
		visualStateAt: (coord: RH.GridCoord, roomFocused: boolean) => VisualState,
		wallHeightScale: number,
		registerConnector: (
			vertex: RH.GridVertex,
			base: ScreenPoint,
			height: number,
			foundationBottomY: number,
			state: VisualState,
			barrier: RH.EdgeBarrier,
			occluderPolygon?: number[],
		) => void,
	): Drawable {
		const profile = barrierRenderProfileFor(barrier);
		const material = resolveBarrierMaterial(barrier);
		const isFocusedBoundary =
			focusBoundaryKeys?.has(this.edgeDedupeKey(coord, other)) ?? false;
		const roomFocused = focusBoundaryKeys !== null && !isFocusedBoundary;

		const STATE_RANK: Record<VisualState, number> = {
			hidden: 0,
			washed: 1,
			normal: 2,
		};
		const stateAtCoord = visualStateAt(coord, roomFocused);
		const stateAtOther = visualStateAt(other, roomFocused);
		const state =
			STATE_RANK[stateAtCoord] >= STATE_RANK[stateAtOther]
				? stateAtCoord
				: stateAtOther;

		/**
		 * The barrier loops always pass `other` as the +x/+y tile. With the
		 * current fixed isometric camera that is the camera-front tile.
		 * The profile decides whether this barrier needs tile-top occlusion.
		 */
		const frontElevation = this.elevationAt(compiled, other);
		const occluderPolygon =
			profile.terrainOcclusion === "front-tile" &&
			frontElevation !== undefined &&
			Number.isFinite(frontElevation) &&
			stateAtOther !== "hidden"
				? this.tileTopOcclusionPolygon(other, frontElevation)
				: undefined;

		const baseHeight =
			WALL_HEIGHT_PX * profile.heightFraction * wallHeightScale;
		const height = isFocusedBoundary
			? baseHeight * FOCUSED_WALL_HEIGHT_FRACTION
			: baseHeight;

		const edge = RH.structuralEdgeForTilePair(coord, other, barrier);
		if (!edge) {
			return {
				layer: "world",
				depth: -Infinity,
				draw: () => new Graphics(),
			};
		}

		const skeleton = this.buildBarrierSegmentSkeleton(
			edge,
			compiled,
			height,
			profile.segmentThicknessPx,
		);

		if (profile.showConnector) {
			registerConnector(
				skeleton.startVertex,
				skeleton.centerBase1,
				height,
				skeleton.foundationCenter1.y,
				state,
				barrier,
				occluderPolygon,
			);

			registerConnector(
				skeleton.endVertex,
				skeleton.centerBase2,
				height,
				skeleton.foundationCenter2.y,
				state,
				barrier,
				occluderPolygon,
			);
		}

		if (state === "hidden") {
			return {
				layer: "world",
				depth: -Infinity,
				draw: () => new Graphics(),
			};
		}

		return {
			layer: "world",
			depth: skeleton.depth + WORLD_DEPTH_BIAS.barrierSegment,
			draw: () => {
				const view = this.barrierSegmentView(
					edge,
					skeleton,
					profile,
					material,
					state,
				);

				if (occluderPolygon) {
					this.applyInverseWorldMask(view, [occluderPolygon]);
				}

				return view;
			},
		};
	}

	private barrierConnectorDrawable(
		screenPos: ScreenPoint,
		height: number,
		foundationBottomY: number,
		washed: boolean,
		barrier: RH.EdgeBarrier,
		occluderPolygons: readonly number[][],
	): Drawable {
		const profile = barrierRenderProfileFor(barrier);
		const material = resolveBarrierMaterial(barrier);

		const { x: cx, y: cy } = screenPos;
		const foundationDrop = Math.max(0, foundationBottomY - cy);
		const half = profile.connectorHalfPx;

		const top = { x: cx, y: cy - half };
		const right = { x: cx + half, y: cy };
		const bottom = { x: cx, y: cy + half };
		const left = { x: cx - half, y: cy };

		const lowerRight = { x: right.x, y: right.y + foundationDrop };
		const lowerBottom = { x: bottom.x, y: bottom.y + foundationDrop };
		const lowerLeft = { x: left.x, y: left.y + foundationDrop };
		const up = (p: ScreenPoint): ScreenPoint => ({
			x: p.x,
			y: p.y - height,
		});

		const depth = cy + WORLD_DEPTH_BIAS.barrierConnector;

		return {
			layer: "world",
			depth,
			draw: () => {
				const view = new Container();
				const topU = up(top);
				const rightU = up(right);
				const bottomU = up(bottom);
				const leftU = up(left);

				const leftFace: BarrierSurfaceQuad = [
					leftU,
					bottomU,
					lowerBottom,
					lowerLeft,
				];
				const rightFace: BarrierSurfaceQuad = [
					bottomU,
					rightU,
					lowerRight,
					lowerBottom,
				];
				const topFace: BarrierSurfaceQuad = [topU, rightU, bottomU, leftU];

				const faceTexture =
					material.connectorFaceTexture ?? material.segmentFaceTexture;
				const topTexture =
					material.connectorTopTexture ?? material.segmentTopTexture;
				const connectorV =
					(Math.max(1, height + foundationDrop) / WALL_HEIGHT_PX) *
					profile.faceUvPerStorey;

				addBarrierQuadSurface(
					view,
					leftFace,
					faceTexture,
					profile.connectorLeftColor,
					profile.connectorAlpha,
					[0, 0, 1, 0, 1, connectorV, 0, connectorV],
				);

				addBarrierQuadSurface(
					view,
					rightFace,
					faceTexture,
					profile.connectorRightColor,
					profile.connectorAlpha,
					[0, 0, 1, 0, 1, connectorV, 0, connectorV],
				);

				if (profile.showConnectorTop) {
					addBarrierQuadSurface(
						view,
						topFace,
						topTexture,
						profile.connectorTopColor,
						profile.connectorAlpha,
					);
				}

				if (washed) {
					addBarrierQuadOverlay(view, leftFace, WASH_COLOR, WASH_ALPHA);
					addBarrierQuadOverlay(view, rightFace, WASH_COLOR, WASH_ALPHA);

					if (profile.showConnectorTop) {
						addBarrierQuadOverlay(view, topFace, WASH_COLOR, WASH_ALPHA);
					}
				}

				if (
					profile.terrainOcclusion === "front-tile" &&
					occluderPolygons.length > 0
				) {
					this.applyInverseWorldMask(view, occluderPolygons);
				}

				return view;
			},
		};
	}
}
