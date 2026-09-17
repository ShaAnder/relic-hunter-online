import { compileEdgeMap, EdgeMapTileCode, type CompiledEdgeMap } from "./edgeMapCompiler";

/**
 * Elevation a StairConnector renders at once we know which side of a
 * matched pair it's on — the lower floor's copy rises up out of its
 * own ground level, the upper floor's copy sits sunken into its own,
 * so the two read as one continuous rise across the instant
 * floor-switch. See StairConnector's own doc comment in
 * EdgeMapTileCode for the full rationale.
 */
const CONNECTOR_LOWER_ELEVATION = 0.5;
const CONNECTOR_UPPER_ELEVATION = -0.5;

/**
 * All floors of one map, bundled together. Every map is this shape
 * now, even a single-floor one — just a bundle with one entry — so
 * there's only ever one data shape to reason about, not "the old
 * single-floor kind" and "the new multi-floor kind" living side by
 * side.
 *
 * floors is ordered bottom-to-top (deepest basement first, highest
 * floor last) — array index, not floor number, is the thing every
 * other piece of this system (the validator, floor-switching later)
 * actually keys off. groundFloorIndex says which array index counts
 * as "floor 0" for display purposes (what the player sees as "Ground
 * Floor" versus "Basement 1" versus "Floor 2"), decoupling storage
 * order from the number shown in the UI.
 */
export interface MapBundle {
	name: string;
	floors: number[][][]; // each entry is one floor's double-resolution blueprint
	groundFloorIndex: number;
}

/** One problem the validator found — always names the exact floor and, where relevant, the exact tile, since "something's wrong somewhere" isn't actionable and "Floor 2 (14, 8)" is. */
export interface ValidationIssue {
	message: string;
	floorIndex: number;
	coord?: { x: number; y: number };
}

export interface ValidationResult {
	valid: boolean;
	issues: ValidationIssue[];
}

/** Reads one tile's code out of a floor's double-resolution blueprint at logical (x, y) — logical coordinates are half the blueprint's own indices, since every other position in a double-resolution grid is an edge slot, not a tile. */
function tileCodeAt(floorBlueprint: number[][], x: number, y: number): number | null {
	const row = floorBlueprint[2 * y];
	if (row === undefined) return null;
	const value = row[2 * x];
	return value === undefined ? null : value;
}

function logicalWidth(floorBlueprint: number[][]): number {
	return ((floorBlueprint[0]?.length ?? 1) + 1) / 2;
}

function logicalHeight(floorBlueprint: number[][]): number {
	return (floorBlueprint.length + 1) / 2;
}

/**
 * Hard-block validation for publishing a map. Checks, for every
 * floor:
 *
 *  - Every StairConnector has a matching StairConnector at the
 *    identical (x, y) on the floor above, the floor below, or both.
 *    A StairConnector is the SAME tile code on every floor it
 *    appears on — unlike a ladder's bottom/top, there's no way to
 *    tell "which side of the pair" a connector is just from its own
 *    code, so matching is checked symmetrically in both directions
 *    rather than assuming one specific neighbor. A connector matching
 *    neither direction is exactly as broken as a door that opens onto
 *    a wall — it should never make it into a published map.
 *    (StairBottom/StairTop are purely decorative landings now and
 *    carry no matching requirement at all — see their doc comments in
 *    EdgeMapTileCode.)
 *  - Every LadderBottom has a matching LadderTop at the identical
 *    (x, y) one floor up, and vice versa — unchanged, ladders stay
 *    simple with no equivalent of StairConnector.
 *  - Every floor above the ground floor has at least one valid
 *    connector down to the floor below it, and every floor below
 *    ground has at least one valid connector up to the floor above
 *    it — a floor with zero working connectors is unreachable, which
 *    is a real, more severe problem than a single dangling connector.
 *
 * Returns every issue found, not just the first one — publishing
 * should show the whole list in one pass, not make someone fix one
 * thing, republish, find the next thing, republish again.
 */
export function validateMapBundle(bundle: MapBundle): ValidationResult {
	const issues: ValidationIssue[] = [];

	if (bundle.floors.length === 0) {
		return {
			valid: false,
			issues: [{ message: "Map has no floors at all.", floorIndex: -1 }],
		};
	}

	// floorConnectedUp[i] / floorConnectedDown[i] track whether floor i
	// has at least one VALID (matched) connector reaching the floor
	// above / below it, for the "is this floor reachable" check below.
	const floorConnectedUp = bundle.floors.map(() => false);
	const floorConnectedDown = bundle.floors.map(() => false);

	for (let floorIndex = 0; floorIndex < bundle.floors.length; floorIndex++) {
		const floor = bundle.floors[floorIndex];
		const width = logicalWidth(floor);
		const height = logicalHeight(floor);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const code = tileCodeAt(floor, x, y);
				if (code === null) continue;

				if (code === EdgeMapTileCode.StairConnector) {
					const below = bundle.floors[floorIndex - 1];
					const above = bundle.floors[floorIndex + 1];
					const matchesBelow =
						below !== undefined &&
						tileCodeAt(below, x, y) === EdgeMapTileCode.StairConnector;
					const matchesAbove =
						above !== undefined &&
						tileCodeAt(above, x, y) === EdgeMapTileCode.StairConnector;

					if (!matchesBelow && !matchesAbove) {
						issues.push({
							message: `Staircase connector at (${x}, ${y}) has no matching connector at the same position on the floor above or below.`,
							floorIndex,
							coord: { x, y },
						});
						continue;
					}
					if (matchesBelow) {
						floorConnectedDown[floorIndex] = true;
						floorConnectedUp[floorIndex - 1] = true;
					}
					if (matchesAbove) {
						floorConnectedUp[floorIndex] = true;
						floorConnectedDown[floorIndex + 1] = true;
					}
					continue;
				}

				if (code === EdgeMapTileCode.LadderBottom || code === EdgeMapTileCode.LadderTop) {
					const isBottom = code === EdgeMapTileCode.LadderBottom;
					const neighborFloorIndex = isBottom ? floorIndex + 1 : floorIndex - 1;
					const neighborFloor = bundle.floors[neighborFloorIndex];
					const expectedMatch = isBottom
						? EdgeMapTileCode.LadderTop
						: EdgeMapTileCode.LadderBottom;

					if (!neighborFloor) {
						issues.push({
							message: `Ladder ${isBottom ? "bottom" : "top"} at (${x}, ${y}) has no floor ${isBottom ? "above" : "below"} to connect to.`,
							floorIndex,
							coord: { x, y },
						});
						continue;
					}

					const neighborCode = tileCodeAt(neighborFloor, x, y);
					if (neighborCode !== expectedMatch) {
						issues.push({
							message: `Ladder ${isBottom ? "bottom" : "top"} at (${x}, ${y}) has no matching ${isBottom ? "top" : "bottom"} at the same position on the floor ${isBottom ? "above" : "below"}.`,
							floorIndex,
							coord: { x, y },
						});
						continue;
					}

					if (isBottom) {
						floorConnectedUp[floorIndex] = true;
						floorConnectedDown[neighborFloorIndex] = true;
					} else {
						floorConnectedDown[floorIndex] = true;
						floorConnectedUp[neighborFloorIndex] = true;
					}
				}
			}
		}
	}

	for (let floorIndex = 0; floorIndex < bundle.floors.length; floorIndex++) {
		const isAboveGround = floorIndex > bundle.groundFloorIndex;
		const isBelowGround = floorIndex < bundle.groundFloorIndex;

		if (isAboveGround && !floorConnectedDown[floorIndex]) {
			issues.push({
				message: `This floor has no working connector down to the floor below it — it's unreachable.`,
				floorIndex,
			});
		}
		if (isBelowGround && !floorConnectedUp[floorIndex]) {
			issues.push({
				message: `This floor has no working connector up to the floor above it — it's unreachable.`,
				floorIndex,
			});
		}
		// Ground floor itself needs no connector at all.
	}

	return { valid: issues.length === 0, issues };
}

/**
 * Compiles every floor of a bundle, then does the one thing a plain
 * per-floor compileEdgeMap can't: gives each matched StairConnector
 * pair its correct elevation, which depends on knowing what's on the
 * *other* floor, not just this one. Everything else about each
 * floor's compile is untouched.
 *
 * A connector matching both the floor above and below at once (a
 * pass-through point on a middle floor) is a real, if unusual, case -
 * this prioritizes the "connects up" (lower-side) elevation for it
 * rather than trying to render both simultaneously, which the
 * instant-floor-switch model has no way to represent anyway.
 */
export function compileMapBundle(bundle: MapBundle): CompiledEdgeMap[] {
	const compiledFloors = bundle.floors.map((blueprint) => compileEdgeMap(blueprint));

	for (let floorIndex = 0; floorIndex < bundle.floors.length; floorIndex++) {
		const floor = bundle.floors[floorIndex];
		const compiled = compiledFloors[floorIndex];
		const below = bundle.floors[floorIndex - 1];
		const width = logicalWidth(floor);
		const height = logicalHeight(floor);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (tileCodeAt(floor, x, y) !== EdgeMapTileCode.StairConnector) continue;

				const matchesBelow =
					below !== undefined &&
					tileCodeAt(below, x, y) === EdgeMapTileCode.StairConnector;
				const above = bundle.floors[floorIndex + 1];
				const matchesAbove =
					above !== undefined &&
					tileCodeAt(above, x, y) === EdgeMapTileCode.StairConnector;

				// Matches below only -> this is the UPPER side of that
				// pair, sunken. Matches above (or both, or neither valid
				// match) -> keep the default lower-side elevation that
				// compileEdgeMap already assigned.
				if (matchesBelow && !matchesAbove) {
					compiled.elevation.set(`${x},${y}`, CONNECTOR_UPPER_ELEVATION);
				} else if (matchesAbove) {
					compiled.elevation.set(`${x},${y}`, CONNECTOR_LOWER_ELEVATION);
				}
			}
		}
	}

	return compiledFloors;
}
