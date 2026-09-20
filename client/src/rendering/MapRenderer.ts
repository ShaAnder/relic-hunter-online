import { Container, Graphics, type Texture } from "pixi.js";
import { resolveTileTexture } from "./materials/mapMaterialFactory";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import * as RH from "@relic-hunter/shared";
import { fillForTileCode } from "./tileFills";

/** Pixels of visual gap a wall piece sits within — this is the "tile, wall, gap, tile" spacing described in prototyping: a small logical gap between what would otherwise be two directly-touching tiles, which the wall piece fills exactly when present, and which the oversized tiles below fill seamlessly when it isn't. */
const GAP_PX = 7;
/** How much larger than its true footprint each tile is drawn — just enough that two neighboring tiles' edges overlap slightly into the gap, so an edge with no wall on it reads as one continuous floor rather than a visible seam. */
const TILE_OVERSIZE = 1.09;
/** Wall piece half-thickness, sized to exactly fill the gap it sits in — no more, so it never eats into either tile's own walkable-looking footprint beyond what the gap already accounts for. */
const WALL_THICKNESS_PX = GAP_PX;
/** Corner piece half-size — matched exactly to wall thickness so a corner connects to any wall meeting it with zero visible gap. */
const CORNER_HALF_PX = WALL_THICKNESS_PX;
const WALL_HEIGHT_PX = TILE_HEIGHT;
/** Doors are drawn shorter than a full wall so they read as an opening rather than a barrier, even before any door-swing animation exists. */
const DOOR_HEIGHT_FRACTION = 0.3;
/** Low walls are a distinct barrier type by design — costs extra movement, does NOT block sight — so they're drawn low enough to read as "steppable obstacle," not a real wall. */
const LOW_WALL_HEIGHT_FRACTION = 0.45;
/** How short a room's own boundary walls become once the player is standing inside that room — tall enough to still read as "there's a wall here" (the outline), short enough not to block the view of the interior or the character standing in it. Visual only: the wall's actual logical height/blocking never changes, only how tall this specific drawing of it is. */
const FOCUSED_WALL_HEIGHT_FRACTION = 0.2;
/** Glass panels render partly see-through, matching their "full height, but transparent" design. */
const GLASS_ALPHA = 0.55;

/**
 * The "not what you're currently looking at" wash — used for BOTH
 * room-focus (dimming every room except the one you're standing in)
 * and fog-of-war's "explored but not currently visible" tier. Same
 * technique, same strength, deliberately: they're the same idea
 * (something real, just not your current focus) and giving them
 * different intensities would need every piece of the map to track
 * WHY it's washed, not just THAT it is — real complexity for a
 * difference nobody asked for. Layered as a second, dark-tinted copy
 * of the same shape drawn on top of the normal (always full-opacity,
 * full-color) one — not as alpha on the object's own color. Blending
 * a shape's own color toward transparency shifts its apparent hue
 * depending on whatever renders behind it, and adjacent oversized
 * tiles overlapping slightly at their shared seam compounds that
 * differently than the rest of the tile — together these produce a
 * visible "colors flipping" artifact at washed tile seams when this
 * is done as a plain g.alpha assignment instead.
 */
const WASH_COLOR = 0x14141e;
const WASH_ALPHA = 0.72;

const FLOOR_COLOR = 0xc8c8c8;

const TERRAIN_SIDE_COLOR = 0x4a4652;

const WALL_TOP_COLOR = 0x463c6e;
const WALL_LEFT_FACE_COLOR = 0x2d2648;
const WALL_RIGHT_FACE_COLOR = 0x372f58;

const DOOR_TOP_COLOR = 0xc8b43c;
const DOOR_LEFT_FACE_COLOR = 0x8c7d28;
const DOOR_RIGHT_FACE_COLOR = 0xaa9632;

/**
 * Fence, glass, and low-wall each get their own muted, in-game-palette
 * color — distinct from a full wall and from each other, and
 * deliberately NOT the bright, saturated colors the Map Creator's own
 * editing palette uses for the same barrier types (those exist purely
 * to be tellable-apart on a small painting grid, not meant to carry
 * into the finished map).
 */
const FENCE_TOP_COLOR = 0x4a5c3c;
const FENCE_LEFT_FACE_COLOR = 0x323f28;
const FENCE_RIGHT_FACE_COLOR = 0x3d4c32;

const GLASS_TOP_COLOR = 0x7d94a0;
const GLASS_LEFT_FACE_COLOR = 0x56666f;
const GLASS_RIGHT_FACE_COLOR = 0x687d87;

const LOW_WALL_TOP_COLOR = 0x5c5648;
const LOW_WALL_LEFT_FACE_COLOR = 0x3e3a30;
const LOW_WALL_RIGHT_FACE_COLOR = 0x4a4539;

type ScreenPoint = { x: number; y: number };

/** One item waiting to be drawn, with the depth key that determines render order — see the class doc comment for why this is the whole mechanism for correct overlap, with no explicit zIndex anywhere. */
interface Drawable {
	depth: number;
	draw: () => Graphics;
}

interface MapMaterialRenderContext {
	mapSeed: number;
	floorIndex: number;
}

/** Per-barrier-type visual info, looked up once per wall/corner piece instead of a growing chain of isDoor/isFence/isGlass/isLowWall ternaries at every color reference. */
interface BarrierStyle {
	heightFraction: number;
	topColor: number;
	leftColor: number;
	rightColor: number;
	alpha: number;
}

const BARRIER_STYLES: Record<number, BarrierStyle> = {
	[RH.EdgeBarrier.FullWall]: {
		heightFraction: 1,
		topColor: WALL_TOP_COLOR,
		leftColor: WALL_LEFT_FACE_COLOR,
		rightColor: WALL_RIGHT_FACE_COLOR,
		alpha: 1,
	},
	[RH.EdgeBarrier.Door]: {
		heightFraction: DOOR_HEIGHT_FRACTION,
		topColor: DOOR_TOP_COLOR,
		leftColor: DOOR_LEFT_FACE_COLOR,
		rightColor: DOOR_RIGHT_FACE_COLOR,
		alpha: 1,
	},
	[RH.EdgeBarrier.Fence]: {
		heightFraction: 1,
		topColor: FENCE_TOP_COLOR,
		leftColor: FENCE_LEFT_FACE_COLOR,
		rightColor: FENCE_RIGHT_FACE_COLOR,
		alpha: 1,
	},
	[RH.EdgeBarrier.Glass]: {
		heightFraction: 1,
		topColor: GLASS_TOP_COLOR,
		leftColor: GLASS_LEFT_FACE_COLOR,
		rightColor: GLASS_RIGHT_FACE_COLOR,
		alpha: GLASS_ALPHA,
	},
	[RH.EdgeBarrier.LowWall]: {
		heightFraction: LOW_WALL_HEIGHT_FRACTION,
		topColor: LOW_WALL_TOP_COLOR,
		leftColor: LOW_WALL_LEFT_FACE_COLOR,
		rightColor: LOW_WALL_RIGHT_FACE_COLOR,
		alpha: 1,
	},
};

function styleFor(barrier: RH.EdgeBarrier): BarrierStyle {
	return BARRIER_STYLES[barrier] ?? BARRIER_STYLES[RH.EdgeBarrier.FullWall];
}

/** What a piece of the map should draw as, combining room-focus and fog-of-war into one answer instead of two separately-applied effects. "hidden" wins over everything (fog unseen); otherwise "washed" if either fog marks it explored-but-not-visible OR room-focus says it's not the room you're in; otherwise "normal". */
type VisualState = "hidden" | "washed" | "normal";

/**
 * A wall's full resolved geometry, computed once via the topology
 * resolver and reused for every face (body, foundation, top). Kept as
 * its own object rather than recomputed inline so a future texture
 * pass has real geometry to consume instead of recalculating it.
 */
interface WallSkeleton {
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
 * The core trick for correct overlap without any zIndex: every tile,
 * wall piece, and corner piece computes a single depth number (the
 * screen-Y of its own forward-most point) before anything is drawn,
 * everything is sorted by that number, and only then added to the
 * container in that order. PixiJS renders children in the order
 * they're added, so painter's-algorithm depth sorting is the entire
 * mechanism — a piece nearer the camera (larger depth) is always
 * added after, and therefore drawn on top of, anything farther away.
 *
 * Room-focus and fog-of-war are both applied at build time, not as
 * later per-object alpha tweaks — passing fresh focusRoom/fog state
 * and rebuilding is simple and correct for a map this size, and
 * critically, keeps both effects going through the exact same code
 * path instead of one being a real rebuild and the other a bolted-on
 * incremental patch that's easy to forget to wire up everywhere the
 * first one already is.
 *
 * Wall/corner geometry goes through the canonical wall-topology
 * resolver (shared/src/world/maps/wallTopology.ts): every wall
 * junction asks that one function for its height, so four wall
 * segments meeting at one physical corner can never disagree with
 * each other about where that corner actually is.
 */
export class MapRenderer {
	constructor(private container: Container) {}

	/**
	 * @param focusRoom When set, this room's own boundary walls draw
	 * visually shorter (an outline you can see and move past, not a
	 * view-blocking wall), and everything not part of this room —
	 * other rooms' tiles, walls, corners, including the open street —
	 * draws with a dark wash over it. Pass null for the normal,
	 * undimmed, full-height view (e.g. while standing outside any
	 * room — the caller is responsible for not passing the outside
	 * room itself here, see MapScene.focusRoomFor).
	 * @param fog When set, applies real fog-of-war on top of
	 * everything else: an unseen tile/wall isn't drawn at all, an
	 * explored-but-not-currently-visible one gets the same dark wash
	 * room-focus uses, and a currently-visible one falls through to
	 * whatever room-focus alone would already give it. Pass null to
	 * disable fog-of-war entirely (matching the mission's own
	 * fogOfWarEnabled toggle).
	 * @param forceWashed When true, renders the whole floor with the
	 * dark washed treatment regardless of fog/room-focus - used for
	 * the lower-floor underlay, so it reads as muted structural
	 * context rather than relying on heavy container transparency.
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
	): void {
		this.container.removeChildren();

		const drawables: Drawable[] = [];

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

				const texture = materialContext
					? resolveTileTexture(
							tileCode,
							coord,
							materialContext.mapSeed,
							materialContext.floorIndex,
						)
					: undefined;

				drawables.push(
					this.tileDrawable(
						coord,
						elevation,
						state === "washed",
						fillForTileCode(tileCode),
						this.tileTouchesElevationBoundary(compiled, coord, elevation),
						texture,
					),
				);
			}
		}

		// ------------------------------------------------------------
		// TERRAIN FACES
		// ------------------------------------------------------------

		// Vertical terrain faces between two horizontally/vertically
		// adjacent tiles with different elevation - the actual
		// curb/cliff skeleton for a raised or sunken tile.
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
		// WALL CORNER COLLECTION
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

		const cornerTouches = new Map<
			string,
			{
				base: ScreenPoint;
				foundationBottomY: number;
				height: number;
				state: VisualState;
				barrier: RH.EdgeBarrier;
			}
		>();

		const registerCorner = (
			vertex: RH.GridVertex,
			base: ScreenPoint,
			height: number,
			foundationBottomY: number,
			state: VisualState,
			barrier: RH.EdgeBarrier,
		): void => {
			const key = `${vertex.x},${vertex.y}`;

			const existing = cornerTouches.get(key);

			const nextHeight = Math.max(existing?.height ?? 0, height);

			const nextFoundationBottomY = Math.max(
				existing?.foundationBottomY ?? base.y,
				foundationBottomY,
			);

			const nextState: VisualState =
				!existing || STATE_RANK[state] > STATE_RANK[existing.state]
					? state
					: existing.state;

			cornerTouches.set(key, {
				// Every connected wall resolves this vertex through
				// the same topology function, so these bases should
				// agree exactly.
				base: existing?.base ?? base,

				foundationBottomY: nextFoundationBottomY,

				height: nextHeight,

				state: nextState,

				barrier:
					!existing || height > existing.height ? barrier : existing.barrier,
			});
		};

		// ------------------------------------------------------------
		// EAST/WEST WALL EDGES
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
					this.wallDrawable(
						a,
						b,
						barrier,
						compiled,
						focusBoundaryKeys,
						visualStateAt,
						wallHeightScale,
						registerCorner,
					),
				);
			}
		}

		// ------------------------------------------------------------
		// NORTH/SOUTH WALL EDGES
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
					this.wallDrawable(
						a,
						b,
						barrier,
						compiled,
						focusBoundaryKeys,
						visualStateAt,
						wallHeightScale,
						registerCorner,
					),
				);
			}
		}

		// ------------------------------------------------------------
		// WALL CORNERS
		// ------------------------------------------------------------

		for (const {
			base,
			foundationBottomY,
			height,
			state,
			barrier,
		} of cornerTouches.values()) {
			if (state === "hidden") {
				continue;
			}

			drawables.push(
				this.cornerDrawable(
					base,
					height,
					foundationBottomY,
					state === "washed",
					barrier,
				),
			);
		}

		// ------------------------------------------------------------
		// FINAL DEPTH SORT + DRAW
		// ------------------------------------------------------------

		drawables.sort((a, b) => a.depth - b.depth);

		for (const d of drawables) {
			this.container.addChild(d.draw());
		}
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
	private tileTouchesElevationBoundary(
		compiled: RH.CompiledEdgeMap,
		coord: RH.GridCoord,
		elevation: number,
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

			const other = this.elevationAt(compiled, neighbour);

			// Only a REAL finite height difference disables oversizing.
			// Void/out-of-bounds does not automatically create a terrain
			// face and should not introduce a new gap.
			if (
				other !== undefined &&
				Number.isFinite(other) &&
				Math.abs(other - elevation) > 0.000001
			) {
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
		texture?: Texture,
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

				if (texture) {
					g.fill({
						texture,
						textureSpace: "local",
					});
				} else {
					g.fill(color);
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
			// Tiles = -100000. Terrain skirts = -50000. Structural walls
			// retain their normal screen-depth values.
			depth: Math.max(a1.y, a2.y, b1.y, b2.y) - 50_000,
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
	 * Full resolved geometry for one wall edge, via the canonical
	 * wall-topology resolver - every wall touching the same physical
	 * vertex asks the same function for that vertex's height, so
	 * connected walls can never disagree about where a shared corner
	 * sits.
	 */
	private buildWallSkeleton(
		edge: RH.StructuralEdgeRef,
		compiled: RH.CompiledEdgeMap,
		height: number,
	): WallSkeleton {
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

		const off = this.perpOffset(raw1, raw2, WALL_THICKNESS_PX);

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
			depth: Math.max(
				centerBase1.y,
				centerBase2.y,
				foundationCenter1.y,
				foundationCenter2.y,
			),
		};
	}

	private wallDrawable(
		coord: RH.GridCoord,
		other: RH.GridCoord,
		barrier: RH.EdgeBarrier,
		compiled: RH.CompiledEdgeMap,
		focusBoundaryKeys: Set<string> | null,
		visualStateAt: (coord: RH.GridCoord, roomFocused: boolean) => VisualState,
		wallHeightScale: number,
		registerCorner: (
			vertex: RH.GridVertex,
			base: ScreenPoint,
			height: number,
			foundationBottomY: number,
			state: VisualState,
			barrier: RH.EdgeBarrier,
		) => void,
	): Drawable {
		const style = styleFor(barrier);
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

		const baseHeight = WALL_HEIGHT_PX * style.heightFraction * wallHeightScale;
		const height = isFocusedBoundary
			? baseHeight * FOCUSED_WALL_HEIGHT_FRACTION
			: baseHeight;

		const edge = RH.structuralEdgeForTilePair(coord, other, barrier);
		if (!edge) {
			return { depth: -Infinity, draw: () => new Graphics() };
		}

		const skeleton = this.buildWallSkeleton(edge, compiled, height);

		registerCorner(
			skeleton.startVertex,
			skeleton.centerBase1,
			height,
			skeleton.foundationCenter1.y,
			state,
			barrier,
		);
		registerCorner(
			skeleton.endVertex,
			skeleton.centerBase2,
			height,
			skeleton.foundationCenter2.y,
			state,
			barrier,
		);

		if (state === "hidden") {
			return { depth: -Infinity, draw: () => new Graphics() };
		}

		return {
			depth: skeleton.depth,
			draw: () => {
				const g = new Graphics();

				const leftFace = [
					skeleton.nearBase1.x,
					skeleton.nearBase1.y,
					skeleton.nearBase2.x,
					skeleton.nearBase2.y,
					skeleton.nearTop2.x,
					skeleton.nearTop2.y,
					skeleton.nearTop1.x,
					skeleton.nearTop1.y,
				];
				const rightFace = [
					skeleton.farBase1.x,
					skeleton.farBase1.y,
					skeleton.farBase2.x,
					skeleton.farBase2.y,
					skeleton.farTop2.x,
					skeleton.farTop2.y,
					skeleton.farTop1.x,
					skeleton.farTop1.y,
				];
				const topFace = [
					skeleton.nearTop1.x,
					skeleton.nearTop1.y,
					skeleton.farTop1.x,
					skeleton.farTop1.y,
					skeleton.farTop2.x,
					skeleton.farTop2.y,
					skeleton.nearTop2.x,
					skeleton.nearTop2.y,
				];
				const foundationLeft = [
					skeleton.foundationNear1.x,
					skeleton.foundationNear1.y,
					skeleton.foundationNear2.x,
					skeleton.foundationNear2.y,
					skeleton.nearBase2.x,
					skeleton.nearBase2.y,
					skeleton.nearBase1.x,
					skeleton.nearBase1.y,
				];
				const foundationRight = [
					skeleton.foundationFar1.x,
					skeleton.foundationFar1.y,
					skeleton.foundationFar2.x,
					skeleton.foundationFar2.y,
					skeleton.farBase2.x,
					skeleton.farBase2.y,
					skeleton.farBase1.x,
					skeleton.farBase1.y,
				];

				if (skeleton.hasFoundation) {
					g.poly(foundationLeft);
					g.fill({ color: style.leftColor, alpha: style.alpha });
					g.poly(foundationRight);
					g.fill({ color: style.rightColor, alpha: style.alpha });
				}

				g.poly(leftFace);
				g.fill({ color: style.leftColor, alpha: style.alpha });
				g.poly(rightFace);
				g.fill({ color: style.rightColor, alpha: style.alpha });
				g.poly(topFace);
				g.fill({ color: style.topColor, alpha: style.alpha });

				if (state === "washed") {
					if (skeleton.hasFoundation) {
						g.poly(foundationLeft);
						g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
						g.poly(foundationRight);
						g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
					}
					g.poly(leftFace);
					g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
					g.poly(rightFace);
					g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
					g.poly(topFace);
					g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
				}
				return g;
			},
		};
	}

	private cornerDrawable(
		screenPos: ScreenPoint,
		height: number,
		foundationBottomY: number,
		washed: boolean,
		barrier: RH.EdgeBarrier,
	): Drawable {
		const style = styleFor(barrier);
		const { x: cx, y: cy } = screenPos;

		const foundationDrop = Math.max(0, foundationBottomY - cy);

		const top = { x: cx, y: cy - CORNER_HALF_PX };
		const right = { x: cx + CORNER_HALF_PX, y: cy };
		const bottom = { x: cx, y: cy + CORNER_HALF_PX };
		const left = { x: cx - CORNER_HALF_PX, y: cy };

		const lowerRight = { x: right.x, y: right.y + foundationDrop };
		const lowerBottom = { x: bottom.x, y: bottom.y + foundationDrop };
		const lowerLeft = { x: left.x, y: left.y + foundationDrop };

		const up = (p: ScreenPoint) => ({ x: p.x, y: p.y - height });
		const depth = lowerBottom.y + 0.1; // corners draw fractionally after walls at the same depth, so they sit visually on top of the seam they're bridging

		return {
			depth,
			draw: () => {
				const g = new Graphics();
				const topU = up(top);
				const rightU = up(right);
				const bottomU = up(bottom);
				const leftU = up(left);

				const leftFace = [
					lowerLeft.x,
					lowerLeft.y,
					lowerBottom.x,
					lowerBottom.y,
					bottomU.x,
					bottomU.y,
					leftU.x,
					leftU.y,
				];
				const rightFace = [
					lowerBottom.x,
					lowerBottom.y,
					lowerRight.x,
					lowerRight.y,
					rightU.x,
					rightU.y,
					bottomU.x,
					bottomU.y,
				];
				const topFace = [
					topU.x,
					topU.y,
					rightU.x,
					rightU.y,
					bottomU.x,
					bottomU.y,
					leftU.x,
					leftU.y,
				];

				g.poly(leftFace);
				g.fill({ color: style.leftColor, alpha: style.alpha });
				g.poly(rightFace);
				g.fill({ color: style.rightColor, alpha: style.alpha });
				g.poly(topFace);
				g.fill({ color: style.topColor, alpha: style.alpha });

				if (washed) {
					g.poly(leftFace);
					g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
					g.poly(rightFace);
					g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
					g.poly(topFace);
					g.fill({ color: WASH_COLOR, alpha: WASH_ALPHA });
				}
				return g;
			},
		};
	}
}
