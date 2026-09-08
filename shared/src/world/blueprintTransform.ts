import type { GridCoord } from "./grid";
import {
	type MapBlueprint,
	BlueprintCode,
	blueprintWidth,
	blueprintHeight,
	createBlueprint,
	getCode,
	setCode,
	inBounds,
} from "./blueprint";

/**
 * Rotates a blueprint 90 degrees clockwise. Generic — works on any
 * blueprint, not just buildings. The whole point of rotating the
 * blueprint itself (rather than rotating coordinates at placement
 * time) is that anything layered on top of a blueprint in the same
 * coordinate space — a door position, a prop list — can go through
 * this exact same transform and stay correctly aligned, since it's
 * one rigid operation applied uniformly, not many independent ones
 * that could drift apart.
 */
export function rotateBlueprint90(bp: MapBlueprint): MapBlueprint {
	const w = blueprintWidth(bp);
	const h = blueprintHeight(bp);
	const rotated = createBlueprint(h, w, BlueprintCode.Wall);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			// (x, y) -> (h - 1 - y, x) is a clockwise quarter turn.
			rotated[x][h - 1 - y] = bp[y][x];
		}
	}
	return rotated;
}

/** Rotates a single coordinate the same way rotateBlueprint90 rotates a whole blueprint — kept in exact lockstep so a door or prop coordinate rotated with this always lands on the matching cell of a blueprint rotated with rotateBlueprint90. */
export function rotateCoord90(coord: GridCoord, sourceHeight: number): GridCoord {
	return { x: sourceHeight - 1 - coord.y, y: coord.x };
}

/**
 * Copies every cell of `stamp` into `target`, offset by `at`, skipping
 * any cell that would land outside target's bounds. Does not check for
 * overlap with existing content — callers that care whether the
 * destination area is clear (buildings placed into an alley network,
 * for instance) need to check that themselves before stamping.
 */
export function stampBlueprint(
	target: MapBlueprint,
	stamp: MapBlueprint,
	at: GridCoord,
): void {
	const w = blueprintWidth(stamp);
	const h = blueprintHeight(stamp);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const dest = { x: at.x + x, y: at.y + y };
			if (!inBounds(target, dest)) continue;
			setCode(target, dest, getCode(stamp, { x, y }));
		}
	}
}
