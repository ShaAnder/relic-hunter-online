import type { Grid, GridCoord } from "./grid";
import type { CharacterClass } from "../types/mercenary";
import { isMeleeClass, isRangedClass } from "./character";

export type ShotQuality = "clear" | "obstructed";

export interface AttackableTile {
	coord: GridCoord;
	quality: ShotQuality;
}

/** First-pass range numbers */
export const ARCHETYPE_RANGE: Record<"melee" | "ranged" | "caster", number> = {
	melee: 1,
	ranged: 5,
	caster: 3,
};

/**
 * Func to get range for chosen archetype
 */
export function getRangeForClass(characterClass: CharacterClass): number {
	if (isRangedClass(characterClass)) return ARCHETYPE_RANGE.ranged;
	if (isMeleeClass(characterClass)) return ARCHETYPE_RANGE.melee;
	return ARCHETYPE_RANGE.caster;
}

/**
 * Every tile the given tiles list between two grid points, using
 * Bresenham's line algorithm
 */
export function tilesBetween(from: GridCoord, to: GridCoord): GridCoord[] {
	const tiles: GridCoord[] = [];
	let x0 = from.x;
	let y0 = from.y;
	const x1 = to.x;
	const y1 = to.y;

	const dx = Math.abs(x1 - x0);
	const dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;

	while (x0 !== x1 || y0 !== y1) {
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y0 += sy;
		}
		if (x0 !== x1 || y0 !== y1) tiles.push({ x: x0, y: y0 });
	}

	return tiles;
}

/** Counts how many tiles along a line are unwalkable. */
function countBlockers(grid: Grid, between: GridCoord[]): number {
	return between.filter((t) => !grid.isWalkable(t)).length;
}

/**
 * Attackable tiles for a given class from its current position. Melee is
 * adjacent-only. Ranged is strict cardinal with zero blocker tolerance —
 * any obstruction removes that tile entirely. Caster is an omnidirectional
 * diamond with one blocker tolerated — costs shot quality, not legality.
 */
export function computeAttackRange(
	grid: Grid,
	selfCoord: GridCoord,
	characterClass: CharacterClass,
	range: number,
): AttackableTile[] {
	if (isMeleeClass(characterClass)) {
		return cardinalAndDiagonalNeighbors(selfCoord)
			.filter((c) => grid.isWalkable(c))
			.map((coord) => ({ coord, quality: "clear" as const }));
	}

	const results: AttackableTile[] = [];

	if (isRangedClass(characterClass)) {
		for (const dir of CARDINAL_DIRECTIONS) {
			for (let dist = 1; dist <= range; dist++) {
				const coord = {
					x: selfCoord.x + dir.x * dist,
					y: selfCoord.y + dir.y * dist,
				};
				if (!grid.isWalkable(coord)) break; // zero tolerance — blocked tile stops the line entirely
				const between = tilesBetween(selfCoord, coord);
				if (countBlockers(grid, between) > 0) break;
				results.push({ coord, quality: "clear" });
			}
		}
		return results;
	}

	// Caster — full diamond, one blocker tolerated per line
	for (let dx = -range; dx <= range; dx++) {
		for (let dy = -range; dy <= range; dy++) {
			if (dx === 0 && dy === 0) continue;
			const dist = Math.abs(dx) + Math.abs(dy);
			if (dist > range) continue;

			const coord = { x: selfCoord.x + dx, y: selfCoord.y + dy };
			if (!grid.isWalkable(coord)) continue;

			const between = tilesBetween(selfCoord, coord);
			const blockers = countBlockers(grid, between);
			if (blockers > 1) continue; // too obstructed, not a legal target at all
			results.push({ coord, quality: blockers === 0 ? "clear" : "obstructed" });
		}
	}

	return results;
}

const CARDINAL_DIRECTIONS: GridCoord[] = [
	{ x: 1, y: 0 },
	{ x: -1, y: 0 },
	{ x: 0, y: 1 },
	{ x: 0, y: -1 },
];

function cardinalAndDiagonalNeighbors(coord: GridCoord): GridCoord[] {
	const offsets = [
		{ x: 1, y: 0 },
		{ x: -1, y: 0 },
		{ x: 0, y: 1 },
		{ x: 0, y: -1 },
		{ x: 1, y: 1 },
		{ x: 1, y: -1 },
		{ x: -1, y: 1 },
		{ x: -1, y: -1 },
	];
	return offsets.map((o) => ({ x: coord.x + o.x, y: coord.y + o.y }));
}
