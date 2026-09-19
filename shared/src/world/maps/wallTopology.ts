import type { GridCoord } from "../grid";
import { coordKey } from "../grid";
import { EdgeBarrier, type EdgeGrid } from "../edgeGrid";
import type { CompiledEdgeMap } from "./edgeMapCompiler";

export interface GridVertex {
	x: number;
	y: number;
}

export type StructuralEdgeOrientation = "north" | "west";

export interface StructuralEdgeRef {
	orientation: StructuralEdgeOrientation;
	/** EdgeGrid storage coordinate: north[y][x] / west[y][x]. */
	x: number;
	y: number;
	barrier: EdgeBarrier;
}

/**
 * Converts the renderer's two adjacent tile coords into the actual
 * EdgeGrid storage identity.
 */
export function structuralEdgeForTilePair(
	a: GridCoord,
	b: GridCoord,
	barrier: EdgeBarrier,
): StructuralEdgeRef | null {
	if (barrier === EdgeBarrier.None) return null;

	if (a.y === b.y && Math.abs(a.x - b.x) === 1) {
		const right = a.x > b.x ? a : b;
		return { orientation: "west", x: right.x, y: right.y, barrier };
	}

	if (a.x === b.x && Math.abs(a.y - b.y) === 1) {
		const lower = a.y > b.y ? a : b;
		return { orientation: "north", x: lower.x, y: lower.y, barrier };
	}

	return null;
}

/** Topological endpoints of one stored structural edge. */
export function structuralEdgeVertices(
	edge: StructuralEdgeRef,
): [GridVertex, GridVertex] {
	if (edge.orientation === "north") {
		return [
			{ x: edge.x, y: edge.y },
			{ x: edge.x + 1, y: edge.y },
		];
	}

	return [
		{ x: edge.x, y: edge.y },
		{ x: edge.x, y: edge.y + 1 },
	];
}

/**
 * ONLY actually-placed structural barriers participate.
 *
 * None is deliberately excluded.
 *
 * O(1): four direct EdgeGrid array lookups.
 */
export function incidentStructuralEdges(
	edges: EdgeGrid,
	vertex: GridVertex,
): StructuralEdgeRef[] {
	const result: StructuralEdgeRef[] = [];

	const addNorth = (x: number, y: number): void => {
		const barrier = edges.north[y]?.[x];
		if (barrier === undefined || barrier === EdgeBarrier.None) return;
		result.push({ orientation: "north", x, y, barrier });
	};

	const addWest = (x: number, y: number): void => {
		const barrier = edges.west[y]?.[x];
		if (barrier === undefined || barrier === EdgeBarrier.None) return;
		result.push({ orientation: "west", x, y, barrier });
	};

	addNorth(vertex.x - 1, vertex.y);
	addNorth(vertex.x, vertex.y);
	addWest(vertex.x, vertex.y - 1);
	addWest(vertex.x, vertex.y);

	return result;
}

export function tilesTouchingStructuralEdge(
	edge: StructuralEdgeRef,
): GridCoord[] {
	if (edge.orientation === "north") {
		return [
			{ x: edge.x, y: edge.y - 1 },
			{ x: edge.x, y: edge.y },
		];
	}

	return [
		{ x: edge.x - 1, y: edge.y },
		{ x: edge.x, y: edge.y },
	];
}

function finiteTerrainHeightsForEdge(
	compiled: CompiledEdgeMap,
	edge: StructuralEdgeRef,
): number[] {
	const values: number[] = [];

	for (const coord of tilesTouchingStructuralEdge(edge)) {
		if (
			coord.x < 0 ||
			coord.y < 0 ||
			coord.x >= compiled.grid.width ||
			coord.y >= compiled.grid.height
		) {
			continue;
		}

		const elevation = compiled.elevation.get(coordKey(coord));
		if (elevation !== undefined && Number.isFinite(elevation)) {
			values.push(elevation);
		}
	}

	return values;
}

/** Architectural base plane of THIS edge. */
export function edgeSupportHeight(
	compiled: CompiledEdgeMap,
	edge: StructuralEdgeRef,
): number | null {
	const values = finiteTerrainHeightsForEdge(compiled, edge);
	return values.length > 0 ? Math.max(...values) : null;
}

/**
 * Lowest physical surface directly beside THIS edge.
 *
 * This is the wall-foundation/skirt target.
 */
export function edgeFoundationHeight(
	compiled: CompiledEdgeMap,
	edge: StructuralEdgeRef,
): number | null {
	const values = finiteTerrainHeightsForEdge(compiled, edge);
	return values.length > 0 ? Math.min(...values) : null;
}

/**
 * Canonical architectural wall height at one junction.
 *
 * Only real structural edges physically connected at this vertex can
 * influence it. A diagonally-touching high tile with no incident wall
 * has zero influence - this is what a naive "max of the four tiles
 * touching this vertex" rule gets wrong: an unrelated high tile that
 * merely shares a corner point, with no wall of its own reaching that
 * point, must not be able to pull a completely different wall's
 * corner upward.
 */
export function resolveWallJunctionHeight(
	compiled: CompiledEdgeMap,
	currentEdge: StructuralEdgeRef,
	vertex: GridVertex,
): number {
	const incident = incidentStructuralEdges(compiled.edges, vertex);

	const supports = incident
		.map((edge) => edgeSupportHeight(compiled, edge))
		.filter((value): value is number => value !== null);

	if (supports.length > 0) {
		return Math.max(...supports);
	}

	/**
	 * Defensive fallback.
	 *
	 * While rendering a real structural edge, currentEdge itself should
	 * necessarily be incident to this vertex, so this should not
	 * normally execute.
	 */
	return edgeSupportHeight(compiled, currentEdge) ?? 0;
}
