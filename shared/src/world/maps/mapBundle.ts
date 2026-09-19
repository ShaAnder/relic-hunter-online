import {
	compileEdgeMap,
	EdgeMapTileCode,
	defaultElevationStepForTileCode,
	isStairTraversalTileCode,
	type CompiledEdgeMap,
} from "./edgeMapCompiler";
import { ALLEYWAYS_EDGE_BLUEPRINT } from "./alleywaysEdgeBlueprint";
import { clampElevationStep, MAX_STAIR_EDGE_DELTA_STEPS } from "./elevation";

/**
 * One floor's material/structure plus its authored elevation data,
 * as a single object rather than two separately-indexed arrays -
 * a floor and its elevation data physically cannot drift to
 * different array indices when they're the same object.
 *
 * elevationSteps is unused as of Stage A (Stage B gives it physical
 * meaning) but lives here now so Stage B never has to touch the data
 * shape again.
 */
export interface MapFloorDefinition {
	/**
	 * Existing double-resolution map blueprint:
	 *
	 * even/even = tile
	 * odd/even or even/odd = edge
	 * odd/odd = unused
	 */
	blueprint: number[][];

	/**
	 * Explicit authored terrain elevation steps keyed by logical
	 * coordinate ("x,y"). Empty during Stage A.
	 */
	elevationSteps: Record<string, number>;
}

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
	/**
	 * Blueprint + elevation are one object per floor so they cannot
	 * drift into separate array indices.
	 */
	floors: MapFloorDefinition[];
	groundFloorIndex: number;
}

function isBlueprint(value: unknown): value is number[][] {
	return (
		Array.isArray(value) &&
		value.every(
			(row) =>
				Array.isArray(row) &&
				row.every((cell) => typeof cell === "number" && Number.isFinite(cell)),
		)
	);
}

function isElevationStepRecord(
	value: unknown,
): value is Record<string, number> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value as Record<string, unknown>).every(
			(step) => typeof step === "number" && Number.isFinite(step),
		)
	);
}

/**
 * Reads both the OLD map shape (floors: number[][][]) and the NEW
 * one (floors: MapFloorDefinition[]) and always returns the new
 * canonical shape. Every caller loading a bundle from storage should
 * go through this rather than trusting the raw parsed JSON's shape.
 */
export function normalizeMapBundle(value: unknown): MapBundle | null {
	if (typeof value !== "object" || value === null) return null;

	const candidate = value as Record<string, unknown>;

	if (
		typeof candidate.name !== "string" ||
		!Array.isArray(candidate.floors) ||
		candidate.floors.length === 0 ||
		typeof candidate.groundFloorIndex !== "number" ||
		!Number.isInteger(candidate.groundFloorIndex)
	) {
		return null;
	}

	const floors: MapFloorDefinition[] = [];

	for (const rawFloor of candidate.floors) {
		// Legacy floor: a bare blueprint array.
		if (isBlueprint(rawFloor)) {
			floors.push({ blueprint: rawFloor, elevationSteps: {} });
			continue;
		}

		if (
			typeof rawFloor !== "object" ||
			rawFloor === null ||
			Array.isArray(rawFloor)
		) {
			return null;
		}

		const floorObject = rawFloor as Record<string, unknown>;

		if (!isBlueprint(floorObject.blueprint)) return null;

		const rawSteps = floorObject.elevationSteps;
		if (rawSteps !== undefined && !isElevationStepRecord(rawSteps)) {
			return null;
		}

		floors.push({
			blueprint: floorObject.blueprint,
			elevationSteps: rawSteps === undefined ? {} : rawSteps,
		});
	}

	if (
		candidate.groundFloorIndex < 0 ||
		candidate.groundFloorIndex >= floors.length
	) {
		return null;
	}

	return {
		name: candidate.name,
		floors,
		groundFloorIndex: candidate.groundFloorIndex,
	};
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
function tileCodeAt(
	floorBlueprint: number[][],
	x: number,
	y: number,
): number | null {
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

/** Reads a floor's blueprint out of the bundle at floorIndex, or undefined if that index doesn't exist. */
function blueprintAt(
	bundle: MapBundle,
	floorIndex: number,
): number[][] | undefined {
	return bundle.floors[floorIndex]?.blueprint;
}

/** The authored elevation step at a logical coordinate on one floor - the explicit override if one was painted, otherwise the tile's material default. */
function elevationStepAt(
	bundle: MapBundle,
	floorIndex: number,
	x: number,
	y: number,
): number {
	const floor = bundle.floors[floorIndex];
	if (!floor) return 0;

	const code = tileCodeAt(floor.blueprint, x, y);
	if (code === null) return 0;

	const override = floor.elevationSteps[`${x},${y}`];

	return override === undefined
		? defaultElevationStepForTileCode(code as EdgeMapTileCode)
		: clampElevationStep(override);
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
		const floor = bundle.floors[floorIndex].blueprint;
		const width = logicalWidth(floor);
		const height = logicalHeight(floor);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const code = tileCodeAt(floor, x, y);
				if (code === null) continue;

				const typedCode = code as EdgeMapTileCode;
				if (isStairTraversalTileCode(typedCode)) {
					const hereStep = elevationStepAt(bundle, floorIndex, x, y);

					// East and south only so every pair gets validated once.
					const neighbours = [
						{ x: x + 1, y },
						{ x, y: y + 1 },
					];

					for (const neighbour of neighbours) {
						const neighbourCode = tileCodeAt(floor, neighbour.x, neighbour.y);

						if (
							neighbourCode === null ||
							!isStairTraversalTileCode(neighbourCode as EdgeMapTileCode)
						) {
							continue;
						}

						const neighbourStep = elevationStepAt(
							bundle,
							floorIndex,
							neighbour.x,
							neighbour.y,
						);

						if (
							Math.abs(neighbourStep - hereStep) > MAX_STAIR_EDGE_DELTA_STEPS
						) {
							issues.push({
								message:
									`Stair tiles at (${x}, ${y}) and ` +
									`(${neighbour.x}, ${neighbour.y}) jump more than ` +
									`${MAX_STAIR_EDGE_DELTA_STEPS} elevation step.`,
								floorIndex,
								coord: { x, y },
							});
						}
					}
				}

				if (code === EdgeMapTileCode.StairConnector) {
					const below = blueprintAt(bundle, floorIndex - 1);
					const above = blueprintAt(bundle, floorIndex + 1);
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

				if (
					code === EdgeMapTileCode.LadderBottom ||
					code === EdgeMapTileCode.LadderTop
				) {
					const isBottom = code === EdgeMapTileCode.LadderBottom;
					const neighborFloorIndex = isBottom ? floorIndex + 1 : floorIndex - 1;
					const neighborFloor = blueprintAt(bundle, neighborFloorIndex);
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
 *
 * Stage A of the elevation rebuild: this behavior is kept completely
 * intact, only reading through .blueprint now.
 */
/**
 * Compiles every floor of a bundle. Elevation is authored directly
 * per-tile now (floor.elevationSteps), so there's no cross-floor
 * connector height adjustment pass to do here anymore - a
 * StairConnector's elevation is whatever was actually painted for it,
 * same as any other tile.
 */
export function compileMapBundle(bundle: MapBundle): CompiledEdgeMap[] {
	return bundle.floors.map((floor) =>
		compileEdgeMap(floor.blueprint, floor.elevationSteps),
	);
}

export function tileCodeAtLogical(
	floorBlueprint: number[][],
	x: number,
	y: number,
): number | null {
	return tileCodeAt(floorBlueprint, x, y);
}

/**
 * If (x, y) on fromFloor is a working stair connector or ladder,
 * return the neighbor floor index to switch to. Otherwise null.
 * Both-direction connectors (rare pass-through) go up.
 */
export function resolveFloorTransition(
	bundle: MapBundle,
	fromFloor: number,
	x: number,
	y: number,
): number | null {
	const floor = blueprintAt(bundle, fromFloor);
	if (!floor) return null;
	const code = tileCodeAt(floor, x, y);
	if (code === null) return null;

	if (code === EdgeMapTileCode.StairConnector) {
		const below = blueprintAt(bundle, fromFloor - 1);
		const above = blueprintAt(bundle, fromFloor + 1);
		const matchesBelow =
			below !== undefined &&
			tileCodeAt(below, x, y) === EdgeMapTileCode.StairConnector;
		const matchesAbove =
			above !== undefined &&
			tileCodeAt(above, x, y) === EdgeMapTileCode.StairConnector;
		if (matchesAbove) return fromFloor + 1;
		if (matchesBelow) return fromFloor - 1;
		return null;
	}

	if (code === EdgeMapTileCode.LadderBottom) {
		const above = blueprintAt(bundle, fromFloor + 1);
		if (above && tileCodeAt(above, x, y) === EdgeMapTileCode.LadderTop) {
			return fromFloor + 1;
		}
		return null;
	}

	if (code === EdgeMapTileCode.LadderTop) {
		const below = blueprintAt(bundle, fromFloor - 1);
		if (below && tileCodeAt(below, x, y) === EdgeMapTileCode.LadderBottom) {
			return fromFloor - 1;
		}
		return null;
	}

	return null;
}

export function officialAlleywaysBundle(): MapBundle {
	return {
		name: "Alleyways",
		floors: [{ blueprint: ALLEYWAYS_EDGE_BLUEPRINT, elevationSteps: {} }],
		groundFloorIndex: 0,
	};
}

/**
 * Resolve a connector specifically in the direction of towardFloor.
 *
 * This differs from resolveFloorTransition(), which has no intended
 * direction and therefore defaults a bidirectional StairConnector upward.
 * AI pathing knows which floor it is trying to reach, so it must use
 * this direction-aware version.
 */
export function resolveFloorTransitionToward(
	bundle: MapBundle,
	fromFloor: number,
	x: number,
	y: number,
	towardFloor: number,
): number | null {
	if (towardFloor === fromFloor) return null;

	const floor = blueprintAt(bundle, fromFloor);
	if (!floor) return null;

	const code = tileCodeAt(floor, x, y);
	if (code === null) return null;

	const goingUp = towardFloor > fromFloor;
	const nextFloor = goingUp ? fromFloor + 1 : fromFloor - 1;

	const neighbor = blueprintAt(bundle, nextFloor);
	if (!neighbor) return null;

	if (code === EdgeMapTileCode.StairConnector) {
		return tileCodeAt(neighbor, x, y) === EdgeMapTileCode.StairConnector
			? nextFloor
			: null;
	}

	if (
		goingUp &&
		code === EdgeMapTileCode.LadderBottom &&
		tileCodeAt(neighbor, x, y) === EdgeMapTileCode.LadderTop
	) {
		return nextFloor;
	}

	if (
		!goingUp &&
		code === EdgeMapTileCode.LadderTop &&
		tileCodeAt(neighbor, x, y) === EdgeMapTileCode.LadderBottom
	) {
		return nextFloor;
	}

	return null;
}

/**
 * Every connector on fromFloor that moves one floor in the direction
 * of towardFloor.
 *
 * This deliberately does NOT choose the nearest connector. The caller
 * has the real wall-aware movement range and is therefore in a much
 * better position to choose the nearest REACHABLE connector.
 */
export function findConnectorsTowardFloor(
	bundle: MapBundle,
	fromFloor: number,
	towardFloor: number,
): { x: number; y: number }[] {
	if (towardFloor === fromFloor) return [];

	const floor = blueprintAt(bundle, fromFloor);
	if (!floor) return [];

	const width = logicalWidth(floor);
	const height = logicalHeight(floor);
	const connectors: { x: number; y: number }[] = [];

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (
				resolveFloorTransitionToward(bundle, fromFloor, x, y, towardFloor) !==
				null
			) {
				connectors.push({ x, y });
			}
		}
	}

	return connectors;
}
