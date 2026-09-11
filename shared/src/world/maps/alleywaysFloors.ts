import { compileAlleywaysMap, type CompiledAlleywaysMap } from "./alleywaysMap";
import { coordKey, type GridCoord } from "../grid";

export interface FloorLink {
	floor: number;
	coord: GridCoord;
}

export interface CompiledAlleywaysFloors {
	/** Index 0 = ground floor, index 1 = second floor, etc. */
	floors: CompiledAlleywaysMap[];
	/**
	 * Where a stairs tile on one floor leads, keyed by `${floor}:${coordKey}`.
	 * Built from same-coordinate matching — a stairs tile at (x,y) on
	 * floor N links to a stairs tile at the same (x,y) on floor N+1 or
	 * N-1 if one exists there. This is deliberately not a hand-authored
	 * link table: every hand-drawn floor already places its own stairs
	 * tiles at the coordinate they're meant to connect through, so the
	 * link falls directly out of the blueprints rather than needing a
	 * separate, drift-prone table kept in sync with them by hand.
	 */
	links: Map<string, FloorLink>;
}

function linkKey(floor: number, coord: GridCoord): string {
	return `${floor}:${coordKey(coord)}`;
}

/**
 * Compiles every floor blueprint given (index order = floor order) and
 * builds the staircase link table between adjacent floors. Only
 * adjacent floors are linked (0<->1, 1<->2, ...) — stairs are a
 * one-floor-at-a-time mechanism, not a lift that can skip floors.
 */
export function compileAlleywaysFloors(
	blueprints: number[][][],
): CompiledAlleywaysFloors {
	const floors = blueprints.map((bp) => compileAlleywaysMap(bp));
	const links = new Map<string, FloorLink>();

	for (let i = 0; i < floors.length - 1; i++) {
		const lower = floors[i];
		const upper = floors[i + 1];
		const upperStairsByKey = new Map(
			upper.stairsTiles.map((c) => [coordKey(c), c] as const),
		);

		for (const coord of lower.stairsTiles) {
			const upperCoord = upperStairsByKey.get(coordKey(coord));
			if (!upperCoord) continue; // this floor's stairs tile has no match above - not every staircase necessarily continues further up
			links.set(linkKey(i, coord), { floor: i + 1, coord: upperCoord });
			links.set(linkKey(i + 1, upperCoord), { floor: i, coord });
		}
	}

	return { floors, links };
}

/** Looks up where the stairs tile at `coord` on `floor` leads, or null if that tile isn't linked to another floor (a stairs tile that only exists on one floor, or a non-stairs tile). */
export function getFloorLink(
	compiled: CompiledAlleywaysFloors,
	floor: number,
	coord: GridCoord,
): FloorLink | null {
	return compiled.links.get(linkKey(floor, coord)) ?? null;
}
