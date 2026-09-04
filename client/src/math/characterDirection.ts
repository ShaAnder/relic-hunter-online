import type { GridCoord } from "@relic-hunter/shared";
import type { IsoFacing } from "@/types/characterSprite";

/**
 * Grid step → isometric facing.
 * TILE projection: +x → SE, +y → SW, -x → NW, -y → NE.
 */
export function getIsoFacing(from: GridCoord, to: GridCoord): IsoFacing {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (dx === 0 && dy === 0) return "se";

	// Pure axis first
	if (dy === 0 && dx > 0) return "se";
	if (dy === 0 && dx < 0) return "nw";
	if (dx === 0 && dy > 0) return "sw";
	if (dx === 0 && dy < 0) return "ne";

	// Diagonals on grid — pick dominant visual iso quadrant
	if (dx > 0 && dy > 0) return Math.abs(dx) >= Math.abs(dy) ? "se" : "sw";
	if (dx > 0 && dy < 0) return Math.abs(dx) >= Math.abs(dy) ? "se" : "ne";
	if (dx < 0 && dy > 0) return Math.abs(dx) >= Math.abs(dy) ? "nw" : "sw";
	return Math.abs(dx) >= Math.abs(dy) ? "nw" : "ne";
}

/**
 * The mirror partner for a facing — NE/NW mirror each other (both
 * "away from camera"), SE/SW mirror each other (both "toward
 * camera"). There is no partner across the N/S divide: a
 * back-facing sprite cannot become a front-facing one by flipping
 * left-right, since those are genuinely different views, not mirror
 * images. Every IsoFacing here happens to have a real partner since
 * all four are diagonals, not straight N/S — this exists purely so
 * the loader has one place to ask "what's the other side of this."
 */
const MIRROR_PARTNER: Record<IsoFacing, IsoFacing> = {
	ne: "nw",
	nw: "ne",
	se: "sw",
	sw: "se",
};

export function mirrorPartner(facing: IsoFacing): IsoFacing {
	return MIRROR_PARTNER[facing];
}

/**
 * True 180° opposite — se↔nw, sw↔ne, matching getIsoFacing's own
 * projection (+x→se, -x→nw, +y→sw, -y→ne). Different from
 * mirrorPartner, which is a left-right flip of the same viewing
 * angle, not a reversal of travel direction. Used when a character
 * retreats back the way it came — facing should flip to match the
 * new direction of travel, not keep facing the original target.
 */
const OPPOSITE_FACING: Record<IsoFacing, IsoFacing> = {
	se: "nw",
	nw: "se",
	sw: "ne",
	ne: "sw",
};

export function oppositeFacing(facing: IsoFacing): IsoFacing {
	return OPPOSITE_FACING[facing];
}

export function getIsoFacingFromScreenDelta(dx: number, dy: number): IsoFacing {
	if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return "se";
	if (dy >= 0 && dx >= 0) return "se";
	if (dy >= 0 && dx < 0) return "sw";
	if (dy < 0 && dx < 0) return "nw";
	return "ne";
}
