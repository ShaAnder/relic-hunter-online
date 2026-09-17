import { Container, Graphics } from "pixi.js";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import * as RH from "@relic-hunter/shared";

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
const PAVEMENT_COLOR = 0xaaaac8;

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
 * first one already is. That's exactly what happened before this: fog
 * had its own separate updateFogVisibility method that nothing ever
 * actually called, so it silently did nothing on every real map.
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
	 * @param tileFills When set, overrides a specific tile's fill color
	 * by coordinate - used for stair/ladder/connector tiles so they
	 * read as distinct from plain floor or pavement rather than
	 * looking like ordinary ground. Elevation-based fog/wash treatment
	 * still applies on top exactly as normal; this only changes the
	 * base color underneath it.
	 */
	build(
		compiled: RH.CompiledEdgeMap,
		focusRoom: RH.Room | null = null,
		fog: {
			state: RH.HasFogOfWar;
			center: RH.GridCoord;
			turn: number;
		} | null = null,
		tileFills: Map<string, number> | null = null,
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
				if (visibility === "unseen") return "hidden";
				if (visibility === "explored") return "washed";
				// "visible": fall through to room-focus, same as fog disabled.
			}
			return roomFocused ? "washed" : "normal";
		};

		for (let y = 0; y < compiled.grid.height; y++) {
			for (let x = 0; x < compiled.grid.width; x++) {
				const coord = { x, y };
				const elevation = compiled.elevation.get(`${x},${y}`) ?? 0;
				if (!Number.isFinite(elevation)) continue; // void — nothing to draw
				const roomFocused =
					focusCellKeys !== null && !focusCellKeys.has(`${x},${y}`);
				const state = visualStateAt(coord, roomFocused);
				if (state === "hidden") continue;
				drawables.push(
					this.tileDrawable(
						coord,
						elevation,
						state === "washed",
						tileFills?.get(`${x},${y}`),
					),
				);
			}
		}

		// rounded screen point -> tallest (state, height) touching it.
		// A corner matches whichever connecting wall needs it most, so
		// it never looks more visible/taller than a wall piece it's
		// directly bridging, and never more hidden than the least
		// hidden of the walls meeting it (a corner between a visible
		// wall and a hidden one still needs to draw).
		const STATE_RANK: Record<VisualState, number> = {
			hidden: 0,
			washed: 1,
			normal: 2,
		};
		const cornerTouches = new Map<
			string,
			{ height: number; state: VisualState; barrier: RH.EdgeBarrier }
		>();

		const registerCorner = (
			b: ScreenPoint,
			height: number,
			state: VisualState,
			barrier: RH.EdgeBarrier,
		) => {
			const key = this.cornerKey(b);
			const existing = cornerTouches.get(key);
			const nextHeight = Math.max(existing?.height ?? 0, height);
			const nextState: VisualState =
				!existing || STATE_RANK[state] > STATE_RANK[existing.state]
					? state
					: existing.state;
			cornerTouches.set(key, {
				height: nextHeight,
				state: nextState,
				barrier:
					nextHeight === height ? barrier : (existing?.barrier ?? barrier),
			});
		};

		for (let y = 0; y < compiled.grid.height; y++) {
			for (let x = 0; x < compiled.grid.width - 1; x++) {
				const a = { x, y };
				const b = { x: x + 1, y };
				const barrier = RH.getEdgeBetween(compiled.edges, a, b);
				if (barrier === RH.EdgeBarrier.None) continue;
				drawables.push(
					this.wallDrawable(
						a,
						b,
						"E",
						barrier,
						compiled,
						focusBoundaryKeys,
						visualStateAt,
						registerCorner,
					),
				);
			}
		}
		for (let y = 0; y < compiled.grid.height - 1; y++) {
			for (let x = 0; x < compiled.grid.width; x++) {
				const a = { x, y };
				const b = { x, y: y + 1 };
				const barrier = RH.getEdgeBetween(compiled.edges, a, b);
				if (barrier === RH.EdgeBarrier.None) continue;
				drawables.push(
					this.wallDrawable(
						a,
						b,
						"S",
						barrier,
						compiled,
						focusBoundaryKeys,
						visualStateAt,
						registerCorner,
					),
				);
			}
		}

		for (const [key, { height, state, barrier }] of cornerTouches) {
			if (state === "hidden") continue;
			const [cx, cy] = key.split(",").map(Number);
			drawables.push(
				this.cornerDrawable(
					{ x: cx, y: cy },
					height,
					state === "washed",
					barrier,
				),
			);
		}

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

	private tileDrawable(
		coord: RH.GridCoord,
		elevation: number,
		washed: boolean,
		fillOverride?: number,
	): Drawable {
		const elevationPx = elevation * TILE_HEIGHT;
		const trueCorners = this.trueTileCorners(coord, elevationPx);
		const hw = (TILE_WIDTH / 2) * TILE_OVERSIZE;
		const hh = (TILE_HEIGHT / 2) * TILE_OVERSIZE;
		const c = trueCorners.center;
		const color =
			fillOverride ?? (elevation > 0 ? PAVEMENT_COLOR : FLOOR_COLOR);
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
				g.fill(color);
				if (washed) {
					g.poly(poly);
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

	private cornerKey(p: ScreenPoint): string {
		return `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;
	}

	private wallDrawable(
		coord: RH.GridCoord,
		other: RH.GridCoord,
		dir: "E" | "S",
		barrier: RH.EdgeBarrier,
		compiled: RH.CompiledEdgeMap,
		focusBoundaryKeys: Set<string> | null,
		visualStateAt: (coord: RH.GridCoord, roomFocused: boolean) => VisualState,
		registerCorner: (
			b: ScreenPoint,
			height: number,
			state: VisualState,
			barrier: RH.EdgeBarrier,
		) => void,
	): Drawable {
		const style = styleFor(barrier);
		const isFocusedBoundary =
			focusBoundaryKeys?.has(this.edgeDedupeKey(coord, other)) ?? false;
		// Not part of the focused room's own boundary at all (and a
		// focus room IS set) means this wall belongs to some other
		// room or the open street — wash it rather than shrink it.
		const roomFocused = focusBoundaryKeys !== null && !isFocusedBoundary;

		// A wall sits BETWEEN two cells — it should render at whichever
		// of them is more visible, not whichever one happened to be
		// "coord" for this loop iteration. coord/other is purely an
		// artifact of iterating x/y in increasing order (coord is
		// always the west or north cell of the pair); it says nothing
		// about which side the player is actually standing on. Using
		// coord alone meant a wall would incorrectly vanish whenever
		// its OTHER side (the one nobody was checking) happened to be
		// unexplored — you can clearly see a wall from the side you're
		// standing next to, even if you've never seen what's past it.
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

		const baseHeight = WALL_HEIGHT_PX * style.heightFraction;
		const height = isFocusedBoundary
			? baseHeight * FOCUSED_WALL_HEIGHT_FRACTION
			: baseHeight;

		// Elevation is used purely to position the wall visually at the
		// correct height on screen - it should reflect real, walkable
		// ground, not whichever cell happened to be "coord" for this
		// loop iteration. Void's elevation is Infinity (see
		// edgeMapCompiler's TILE_ELEVATION), and "coord" is always the
		// west/north cell of the pair - for any wall sitting on the
		// map's outermost boundary, that's exactly the void side. An
		// Infinite elevationPx collapsed every corner of the wall to
		// y=-Infinity, silently drawing it off-screen with no error -
		// not hidden by any visibility check, just geometrically
		// broken. Falls back to "other"'s elevation, and to 0 (floor
		// height) only if genuinely neither side has finite elevation.
		const coordElevation = compiled.elevation.get(`${coord.x},${coord.y}`);
		const otherElevation = compiled.elevation.get(`${other.x},${other.y}`);
		const usableElevation =
			coordElevation !== undefined && Number.isFinite(coordElevation)
				? coordElevation
				: Number.isFinite(otherElevation)
					? otherElevation
					: 0;
		const elevationPx = (usableElevation ?? 0) * TILE_HEIGHT;
		const corners = this.trueTileCorners(coord, elevationPx);
		const [b1, b2] =
			dir === "E"
				? [corners.right, corners.bottom]
				: [corners.bottom, corners.left];

		registerCorner(b1, height, state, barrier);
		registerCorner(b2, height, state, barrier);

		if (state === "hidden") {
			return { depth: -Infinity, draw: () => new Graphics() };
		}

		const off = this.perpOffset(b1, b2, WALL_THICKNESS_PX);
		const near1 = { x: b1.x + off.x, y: b1.y + off.y };
		const near2 = { x: b2.x + off.x, y: b2.y + off.y };
		const far1 = { x: b1.x - off.x, y: b1.y - off.y };
		const far2 = { x: b2.x - off.x, y: b2.y - off.y };
		const up = (p: ScreenPoint) => ({ x: p.x, y: p.y - height });
		const depth = Math.max(b1.y, b2.y);

		return {
			depth,
			draw: () => {
				const g = new Graphics();
				const n1u = up(near1),
					n2u = up(near2),
					f1u = up(far1),
					f2u = up(far2);
				const leftFace = [
					near1.x,
					near1.y,
					near2.x,
					near2.y,
					n2u.x,
					n2u.y,
					n1u.x,
					n1u.y,
				];
				const rightFace = [
					far1.x,
					far1.y,
					far2.x,
					far2.y,
					f2u.x,
					f2u.y,
					f1u.x,
					f1u.y,
				];
				const topFace = [
					n1u.x,
					n1u.y,
					f1u.x,
					f1u.y,
					f2u.x,
					f2u.y,
					n2u.x,
					n2u.y,
				];

				g.poly(leftFace);
				g.fill({ color: style.leftColor, alpha: style.alpha });
				g.poly(rightFace);
				g.fill({ color: style.rightColor, alpha: style.alpha });
				g.poly(topFace);
				g.fill({ color: style.topColor, alpha: style.alpha });

				if (state === "washed") {
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
		washed: boolean,
		barrier: RH.EdgeBarrier,
	): Drawable {
		const style = styleFor(barrier);
		const { x: cx, y: cy } = screenPos;
		const top = { x: cx, y: cy - CORNER_HALF_PX };
		const right = { x: cx + CORNER_HALF_PX, y: cy };
		const bottom = { x: cx, y: cy + CORNER_HALF_PX };
		const left = { x: cx - CORNER_HALF_PX, y: cy };
		const up = (p: ScreenPoint) => ({ x: p.x, y: p.y - height });
		const depth = bottom.y + 0.1; // corners draw fractionally after walls at the same depth, so they sit visually on top of the seam they're bridging

		return {
			depth,
			draw: () => {
				const g = new Graphics();
				const topU = up(top),
					rightU = up(right),
					bottomU = up(bottom),
					leftU = up(left);
				const leftFace = [
					left.x,
					left.y,
					bottom.x,
					bottom.y,
					bottomU.x,
					bottomU.y,
					leftU.x,
					leftU.y,
				];
				const rightFace = [
					bottom.x,
					bottom.y,
					right.x,
					right.y,
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
