import { Grid, coordKey, isAdjacent, type GridCoord } from "./grid";

import {
	EdgeBarrier,
	type EdgeGrid,
	getEdgeBetween,
	edgeIsPassable,
	edgeExtraMovementCost,
} from "./edgeGrid";

import {
	type EdgeMapTileCode,
	isStairTraversalTileCode,
} from "./maps/edgeMapCompiler";

import { MAX_STAIR_EDGE_DELTA_STEPS } from "./maps/elevation";

/**
 * Movement range computed - cost to reach and previous tile.
 *
 * distance is movement COST, not necessarily tile count.
 */
export interface MovementRangeEntry {
	coord: GridCoord;
	distance: number;
	cameFrom: GridCoord | null;
}

/**
 * Traversal policy seam.
 *
 * Actor/class/monster differences belong here rather than in copied
 * pathfinding implementations.
 */
export interface TraversalProfile {
	ignoreElevationPenalty?: boolean;
	ignoreLowWallPenalty?: boolean;
	maxDirectElevationDeltaSteps?: number;
}

export const DEFAULT_TRAVERSAL_PROFILE: Readonly<Required<TraversalProfile>> = {
	ignoreElevationPenalty: false,
	ignoreLowWallPenalty: false,
	maxDirectElevationDeltaSteps: 2,
};

/**
 * Terrain information required by gameplay traversal.
 *
 * Gameplay deliberately reads integer elevationSteps, never resolved
 * render elevation floats.
 */
export interface TerrainTraversalContext {
	elevationSteps?: Map<string, number>;
	tileCodes?: Map<string, EdgeMapTileCode>;
	profile?: TraversalProfile;
}

/**
 * Generic cost provider used by the weighted pathfinder.
 *
 * number = legal traversal cost
 * null   = illegal traversal
 */
export type StepCostProvider = (
	from: GridCoord,
	to: GridCoord,
) => number | null;

/**
 * Central movement tuning.
 *
 * A normal cardinal tile step costs 1.
 * A legal rough elevation transition (delta >= 2) adds one point.
 */
export const BASE_TRAVERSAL_STEP_COST = 1;
export const ROUGH_ELEVATION_DELTA_STEPS = 2;
export const ROUGH_ELEVATION_SURCHARGE = 1;

function resolveTraversalProfile(
	profile?: TraversalProfile,
): Required<TraversalProfile> {
	return {
		ignoreElevationPenalty:
			profile?.ignoreElevationPenalty ??
			DEFAULT_TRAVERSAL_PROFILE.ignoreElevationPenalty,

		ignoreLowWallPenalty:
			profile?.ignoreLowWallPenalty ??
			DEFAULT_TRAVERSAL_PROFILE.ignoreLowWallPenalty,

		maxDirectElevationDeltaSteps:
			profile?.maxDirectElevationDeltaSteps ??
			DEFAULT_TRAVERSAL_PROFILE.maxDirectElevationDeltaSteps,
	};
}

function terrainStepAt(
	context: TerrainTraversalContext | undefined,
	coord: GridCoord,
): number {
	const step = context?.elevationSteps?.get(coordKey(coord));

	return step !== undefined && Number.isFinite(step) ? step : 0;
}

/**
 * ONE authoritative base traversal rule.
 *
 * Responsibilities:
 * - cardinal adjacency
 * - edge passability
 * - integer elevation lookup
 * - stair-to-stair legality
 * - direct elevation legality
 * - elevation surcharge
 * - low-wall surcharge
 * - TraversalProfile overrides
 *
 * This function does NOT know anything about:
 * - AI
 * - ZoC/threat
 * - actors/classes
 * - rendering elevation
 * - pathfinding
 */
export function getTraversalStepCost(
	from: GridCoord,
	to: GridCoord,
	barrier: EdgeBarrier,
	context?: TerrainTraversalContext,
): number | null {
	if (!isAdjacent(from, to)) {
		return null;
	}

	if (!edgeIsPassable(barrier)) {
		return null;
	}

	const profile = resolveTraversalProfile(context?.profile);

	const fromStep = terrainStepAt(context, from);
	const toStep = terrainStepAt(context, to);
	const deltaSteps = Math.abs(toStep - fromStep);

	const fromCode = context?.tileCodes?.get(coordKey(from));
	const toCode = context?.tileCodes?.get(coordKey(to));

	const stairToStair =
		isStairTraversalTileCode(fromCode) && isStairTraversalTileCode(toCode);

	let elevationSurcharge = 0;

	if (stairToStair) {
		/*
		 * Stair runs must progress smoothly one authored elevation
		 * step at a time.
		 *
		 * Stairs bypass the normal rough-elevation surcharge.
		 */
		if (deltaSteps > MAX_STAIR_EDGE_DELTA_STEPS) {
			return null;
		}
	} else {
		if (deltaSteps > profile.maxDirectElevationDeltaSteps) {
			return null;
		}

		if (
			!profile.ignoreElevationPenalty &&
			deltaSteps >= ROUGH_ELEVATION_DELTA_STEPS
		) {
			elevationSurcharge = ROUGH_ELEVATION_SURCHARGE;
		}
	}

	const lowWallSurcharge = profile.ignoreLowWallPenalty
		? 0
		: edgeExtraMovementCost(barrier);

	return BASE_TRAVERSAL_STEP_COST + elevationSurcharge + lowWallSurcharge;
}

/**
 * Cost of THIS exact authored path.
 *
 * Used later by MoveController so a manually dragged expensive route
 * cannot be accepted merely because the same destination has a cheaper
 * alternate route.
 *
 * Returns null if any step in the path is illegal.
 */
export function computePathMovementCost(
	start: GridCoord,
	path: GridCoord[],
	edges?: EdgeGrid | null,
	terrain?: TerrainTraversalContext,
): number | null {
	let total = 0;
	let from = start;

	for (const to of path) {
		const barrier = edges ? getEdgeBetween(edges, from, to) : EdgeBarrier.None;

		const stepCost = getTraversalStepCost(from, to, barrier, terrain);

		if (stepCost === null) {
			return null;
		}

		total += stepCost;
		from = to;
	}

	return total;
}

/**
 * Generic Dijkstra movement search.
 *
 * The search knows nothing about terrain, edges, classes, monsters,
 * hunters or AI policy. All traversal rules are supplied through
 * stepCost.
 */
export function computeWeightedMovementRange(
	grid: Grid,
	start: GridCoord,
	movementBudget: number,
	blockedTiles: Set<string> | undefined,
	stepCost: StepCostProvider,
): Map<string, MovementRangeEntry> {
	const best = new Map<string, MovementRangeEntry>();
	const startKey = coordKey(start);

	best.set(startKey, {
		coord: start,
		distance: 0,
		cameFrom: null,
	});

	interface OpenEntry {
		coord: GridCoord;
		key: string;
		cost: number;
	}

	const open: OpenEntry[] = [
		{
			coord: start,
			key: startKey,
			cost: 0,
		},
	];

	const closed = new Set<string>();

	while (open.length > 0) {
		let cheapestIndex = 0;

		for (let i = 1; i < open.length; i++) {
			if (open[i].cost < open[cheapestIndex].cost) {
				cheapestIndex = i;
			}
		}

		const current = open.splice(cheapestIndex, 1)[0];

		if (closed.has(current.key)) {
			continue;
		}

		closed.add(current.key);

		for (const neighbour of grid.getNeighbors(current.coord)) {
			const key = coordKey(neighbour);

			if (closed.has(key)) continue;
			if (!grid.isWalkable(neighbour)) continue;
			if (blockedTiles?.has(key)) continue;

			const step = stepCost(current.coord, neighbour);

			if (step === null || !Number.isFinite(step) || step < 0) {
				continue;
			}

			const newCost = current.cost + step;

			if (newCost > movementBudget) {
				continue;
			}

			const existing = best.get(key);

			if (!existing || newCost < existing.distance) {
				best.set(key, {
					coord: neighbour,
					distance: newCost,
					cameFrom: current.coord,
				});

				open.push({
					coord: neighbour,
					key,
					cost: newCost,
				});
			}
		}
	}

	return best;
}

/**
 * Classic cell-map movement.
 *
 * Still routes through the generic weighted engine; every legal tile
 * simply costs one movement point.
 */
export function computeMovementRange(
	grid: Grid,
	start: GridCoord,
	movementBudget: number,
	blockedTiles?: Set<string>,
): Map<string, MovementRangeEntry> {
	return computeWeightedMovementRange(
		grid,
		start,
		movementBudget,
		blockedTiles,
		() => BASE_TRAVERSAL_STEP_COST,
	);
}

/**
 * Edge/terrain-aware movement range.
 *
 * All legality/cost comes through getTraversalStepCost.
 */
export function computeMovementRangeWithEdges(
	grid: Grid,
	edges: EdgeGrid,
	start: GridCoord,
	movementBudget: number,
	blockedTiles?: Set<string>,
	terrain?: TerrainTraversalContext,
): Map<string, MovementRangeEntry> {
	return computeWeightedMovementRange(
		grid,
		start,
		movementBudget,
		blockedTiles,
		(from, to) =>
			getTraversalStepCost(from, to, getEdgeBetween(edges, from, to), terrain),
	);
}

/**
 * Single entry for map movement range.
 */
export function computeMapMovementRange(
	grid: Grid,
	start: GridCoord,
	movementBudget: number,
	blockedTiles?: Set<string>,
	edges?: EdgeGrid | null,
	terrain?: TerrainTraversalContext,
): Map<string, MovementRangeEntry> {
	if (edges) {
		return computeMovementRangeWithEdges(
			grid,
			edges,
			start,
			movementBudget,
			blockedTiles,
			terrain,
		);
	}

	return computeMovementRange(grid, start, movementBudget, blockedTiles);
}

export function getPathTo(
	range: Map<string, MovementRangeEntry>,
	destination: GridCoord,
): GridCoord[] | null {
	const destEntry = range.get(coordKey(destination));

	if (!destEntry) return null;

	const path: GridCoord[] = [];
	let current: MovementRangeEntry | undefined = destEntry;

	while (current && current.cameFrom !== null) {
		path.push(current.coord);
		current = range.get(coordKey(current.cameFrom));
	}

	return path.reverse();
}

/**
 * Finds the reachable tile in `range` closest to `target` by real
 * walkable-path cost.
 */
export function findNearestReachableTile(
	grid: Grid,
	range: Map<string, MovementRangeEntry>,
	target: GridCoord,
	blockedTiles?: Set<string>,
	edges?: EdgeGrid | null,
	terrain?: TerrainTraversalContext,
): GridCoord | null {
	if (range.size === 0) return null;

	const directKey = coordKey(target);

	if (range.has(directKey)) {
		return target;
	}

	const targetRange = computeMapMovementRange(
		grid,
		target,
		grid.width * grid.height,
		blockedTiles,
		edges,
		terrain,
	);

	let best: GridCoord | null = null;
	let bestDist = Infinity;

	for (const entry of range.values()) {
		const distFromTarget = targetRange.get(coordKey(entry.coord))?.distance;

		if (distFromTarget === undefined) continue;

		if (distFromTarget < bestDist) {
			bestDist = distFromTarget;
			best = entry.coord;
		}
	}

	return best;
}
