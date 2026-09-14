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
/** How short a room's own boundary walls become once the player is standing inside that room — tall enough to still read as "there's a wall here" (the outline), short enough not to block the view of the interior or the character standing in it. Visual only: the wall's actual logical height/blocking never changes, only how tall this specific drawing of it is. */
const FOCUSED_WALL_HEIGHT_FRACTION = 0.2;
/** Alpha applied to anything outside the player's current room once they're inside one — dimmed enough to read as "not where you are right now," not so dark it disappears, matching a soft JRPG-interior darkening rather than full fog-of-war blackout. */
const UNFOCUSED_ALPHA = 0.3;

const FLOOR_COLOR = 0xc8c8c8;
const PAVEMENT_COLOR = 0xaaaac8;
const WALL_TOP_COLOR = 0x463c6e;
const WALL_LEFT_FACE_COLOR = 0x2d2648;
const WALL_RIGHT_FACE_COLOR = 0x372f58;
const DOOR_TOP_COLOR = 0xc8b43c;
const DOOR_LEFT_FACE_COLOR = 0x8c7d28;
const DOOR_RIGHT_FACE_COLOR = 0xaa9632;

type ScreenPoint = { x: number; y: number };

/** One item waiting to be drawn, with the depth key that determines render order — see the class doc comment for why this is the whole mechanism for correct overlap, with no explicit zIndex anywhere. */
interface Drawable {
	depth: number;
	draw: () => Graphics;
}

/**
 * Renders an edge-based map (Grid + EdgeGrid, from compileEdgeMap) —
 * a prototype, deliberately separate from the production MapRenderer
 * rather than modified into it, since this system isn't proven out
 * against a real map yet.
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
 * Room-focus (the "entering a building" effect) is applied at build
 * time, not as a later per-object alpha tweak — passing a different
 * focusRoom and rebuilding is simple and correct for a map this size;
 * an incremental version would only be worth the complexity on a much
 * larger map.
 */
export class EdgeMapRenderer {
	constructor(private container: Container) {}

	/**
	 * @param focusRoom When set, this room's own boundary walls draw
	 * visually shorter (an outline you can see and move past, not a
	 * view-blocking wall), and everything not part of this room —
	 * other rooms' tiles, walls, corners, including the open street —
	 * draws dimmed. Pass null for the normal, undimmed, full-height
	 * view (e.g. while standing outside any room).
	 */
	build(compiled: RH.CompiledEdgeMap, focusRoom: RH.Room | null = null): void {
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

		for (let y = 0; y < compiled.grid.height; y++) {
			for (let x = 0; x < compiled.grid.width; x++) {
				const coord = { x, y };
				const elevation = compiled.elevation.get(`${x},${y}`) ?? 0;
				if (!Number.isFinite(elevation)) continue; // void — nothing to draw
				const dimmed =
					focusCellKeys !== null && !focusCellKeys.has(`${x},${y}`);
				drawables.push(this.tileDrawable(coord, elevation, dimmed));
			}
		}

		// rounded screen point -> tallest (height, dimmed) touching it.
		// A corner shrinks/dims to match whichever connecting wall
		// needs it most, so it never looks taller or brighter than a
		// wall piece it's directly bridging.
		const cornerTouches = new Map<
			string,
			{ height: number; dimmed: boolean }
		>();

		for (let y = 0; y < compiled.grid.height; y++) {
			for (let x = 0; x < compiled.grid.width - 1; x++) {
				const a = { x, y };
				const b = { x: x + 1, y };
				const barrier = RH.getEdgeBetween(compiled.edges, a, b);
				if (barrier === RH.EdgeBarrier.None) continue;
				drawables.push(
					this.wallDrawable(
						a,
						"E",
						barrier,
						compiled,
						cornerTouches,
						focusBoundaryKeys,
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
						"S",
						barrier,
						compiled,
						cornerTouches,
						focusBoundaryKeys,
					),
				);
			}
		}

		for (const [key, { height, dimmed }] of cornerTouches) {
			const [cx, cy] = key.split(",").map(Number);
			drawables.push(this.cornerDrawable({ x: cx, y: cy }, height, dimmed));
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
		dimmed: boolean,
	): Drawable {
		const elevationPx = elevation * TILE_HEIGHT;
		const trueCorners = this.trueTileCorners(coord, elevationPx);
		const hw = (TILE_WIDTH / 2) * TILE_OVERSIZE;
		const hh = (TILE_HEIGHT / 2) * TILE_OVERSIZE;
		const c = trueCorners.center;
		const color = elevation > 0 ? PAVEMENT_COLOR : FLOOR_COLOR;
		const depth = trueCorners.bottom.y - 100_000; // tiles always sort behind anything standing on their own edge

		return {
			depth,
			draw: () => {
				const g = new Graphics();
				g.poly([c.x, c.y - hh, c.x + hw, c.y, c.x, c.y + hh, c.x - hw, c.y]);
				g.fill(color);
				if (dimmed) g.alpha = UNFOCUSED_ALPHA;
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
		dir: "E" | "S",
		barrier: RH.EdgeBarrier,
		compiled: RH.CompiledEdgeMap,
		cornerTouches: Map<string, { height: number; dimmed: boolean }>,
		focusBoundaryKeys: Set<string> | null,
	): Drawable {
		const isDoor = barrier === RH.EdgeBarrier.Door;
		const other =
			dir === "E"
				? { x: coord.x + 1, y: coord.y }
				: { x: coord.x, y: coord.y + 1 };
		const isFocusedBoundary =
			focusBoundaryKeys?.has(this.edgeDedupeKey(coord, other)) ?? false;
		// Not part of the focused room's own boundary at all (and a
		// focus room IS set) means this wall belongs to some other
		// room or the open street — dim it rather than shrink it.
		const dimmed = focusBoundaryKeys !== null && !isFocusedBoundary;

		const baseHeight = WALL_HEIGHT_PX * (isDoor ? DOOR_HEIGHT_FRACTION : 1);
		const height = isFocusedBoundary
			? baseHeight * FOCUSED_WALL_HEIGHT_FRACTION
			: baseHeight;

		const elevationPx =
			(compiled.elevation.get(`${coord.x},${coord.y}`) ?? 0) * TILE_HEIGHT;
		const corners = this.trueTileCorners(coord, elevationPx);
		const [b1, b2] =
			dir === "E"
				? [corners.right, corners.bottom]
				: [corners.bottom, corners.left];

		for (const b of [b1, b2]) {
			const key = this.cornerKey(b);
			const existing = cornerTouches.get(key);
			// A corner touched by multiple walls takes the tallest
			// height and "dimmed" only if every wall touching it is
			// dimmed — a corner between a focused-boundary wall and an
			// unrelated one should still read as part of the room
			// you're standing in, not fade with its neighbor.
			cornerTouches.set(key, {
				height: Math.max(existing?.height ?? 0, height),
				dimmed: (existing?.dimmed ?? true) && dimmed,
			});
		}

		const off = this.perpOffset(b1, b2, WALL_THICKNESS_PX);
		const near1 = { x: b1.x + off.x, y: b1.y + off.y };
		const near2 = { x: b2.x + off.x, y: b2.y + off.y };
		const far1 = { x: b1.x - off.x, y: b1.y - off.y };
		const far2 = { x: b2.x - off.x, y: b2.y - off.y };
		const up = (p: ScreenPoint) => ({ x: p.x, y: p.y - height });

		const topColor = isDoor ? DOOR_TOP_COLOR : WALL_TOP_COLOR;
		const leftColor = isDoor ? DOOR_LEFT_FACE_COLOR : WALL_LEFT_FACE_COLOR;
		const rightColor = isDoor ? DOOR_RIGHT_FACE_COLOR : WALL_RIGHT_FACE_COLOR;
		const depth = Math.max(b1.y, b2.y);

		return {
			depth,
			draw: () => {
				const g = new Graphics();
				const n1u = up(near1),
					n2u = up(near2),
					f1u = up(far1),
					f2u = up(far2);
				g.poly([
					near1.x,
					near1.y,
					near2.x,
					near2.y,
					n2u.x,
					n2u.y,
					n1u.x,
					n1u.y,
				]);
				g.fill(leftColor);
				g.poly([far1.x, far1.y, far2.x, far2.y, f2u.x, f2u.y, f1u.x, f1u.y]);
				g.fill(rightColor);
				g.poly([n1u.x, n1u.y, f1u.x, f1u.y, f2u.x, f2u.y, n2u.x, n2u.y]);
				g.fill(topColor);
				if (dimmed) g.alpha = UNFOCUSED_ALPHA;
				return g;
			},
		};
	}

	private cornerDrawable(
		screenPos: ScreenPoint,
		height: number,
		dimmed: boolean,
	): Drawable {
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
				g.poly([
					left.x,
					left.y,
					bottom.x,
					bottom.y,
					bottomU.x,
					bottomU.y,
					leftU.x,
					leftU.y,
				]);
				g.fill(WALL_LEFT_FACE_COLOR);
				g.poly([
					bottom.x,
					bottom.y,
					right.x,
					right.y,
					rightU.x,
					rightU.y,
					bottomU.x,
					bottomU.y,
				]);
				g.fill(WALL_RIGHT_FACE_COLOR);
				g.poly([
					topU.x,
					topU.y,
					rightU.x,
					rightU.y,
					bottomU.x,
					bottomU.y,
					leftU.x,
					leftU.y,
				]);
				g.fill(WALL_TOP_COLOR);
				if (dimmed) g.alpha = UNFOCUSED_ALPHA;
				return g;
			},
		};
	}
}
