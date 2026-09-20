import { describe, expect, it } from "vitest";

import { Grid, TileType, coordKey } from "../grid";

import { EdgeBarrier, createEmptyEdgeGrid, setEdgeBetween } from "../edgeGrid";

import { EdgeMapTileCode } from "../maps/edgeMapCompiler";

import {
	computeMovementRange,
	computeMovementRangeWithEdges,
	computePathMovementCost,
	getPathTo,
	getTraversalStepCost,
	type TerrainTraversalContext,
} from "../movement";

/**
 * First real test in the project — deliberately not a trivial
 * one-liner. computeMovementRange/getPathTo is the exact pathfinding
 * pair reused across tonight's tutorial work (Kessler's scripted
 * movement, the tutorial monster's dash), so a real test here both
 * proves the Vitest pipeline actually works end to end and locks in
 * behavior genuinely worth protecting from an accidental regression.
 */
describe("computeMovementRange + getPathTo", () => {
	it("finds a straight-line path across an open grid", () => {
		const grid = new Grid(5, 5);
		const range = computeMovementRange(grid, { x: 0, y: 0 }, 10, new Set());

		const path = getPathTo(range, { x: 3, y: 0 });

		expect(path).not.toBeNull();
		expect(path).toEqual([
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 3, y: 0 },
		]);
	});

	it("returns null when the destination is outside the movement budget", () => {
		const grid = new Grid(10, 10);
		const range = computeMovementRange(grid, { x: 0, y: 0 }, 2, new Set());

		const path = getPathTo(range, { x: 5, y: 0 });

		expect(path).toBeNull();
	});

	it("routes around a wall rather than passing through it", () => {
		const grid = new Grid(3, 3);
		grid.setTileType({ x: 1, y: 0 }, TileType.Wall);
		grid.setTileType({ x: 1, y: 1 }, TileType.Wall);

		const range = computeMovementRange(grid, { x: 0, y: 0 }, 10, new Set());
		const path = getPathTo(range, { x: 2, y: 0 });

		expect(path).not.toBeNull();
		// Can't be a straight 2-tile line through the wall column —
		// must detour through row 2, the only open row.
		expect(path!.length).toBeGreaterThan(2);
		expect(path).not.toContainEqual({ x: 1, y: 0 });
		expect(path).not.toContainEqual({ x: 1, y: 1 });
	});

	it("treats an explicitly blocked tile as impassable even though it's a walkable Floor tile", () => {
		const grid = new Grid(3, 1);
		const blocked = new Set([coordKey({ x: 1, y: 0 })]);

		const range = computeMovementRange(grid, { x: 0, y: 0 }, 10, blocked);
		const path = getPathTo(range, { x: 2, y: 0 });

		// The only route is through (1,0), which is walkable terrain but
		// occupied — this is exactly the mechanism dashMonsterToPlayer
		// relies on to avoid landing directly on the player's own tile.
		expect(path).toBeNull();
	});
});

describe("terrain traversal authority", () => {
	const from = { x: 0, y: 0 };
	const to = { x: 1, y: 0 };

	function terrain(
		fromStep: number,
		toStep: number,
		fromCode: EdgeMapTileCode = EdgeMapTileCode.Floor,
		toCode: EdgeMapTileCode = EdgeMapTileCode.Floor,
	): TerrainTraversalContext {
		return {
			elevationSteps: new Map([
				[coordKey(from), fromStep],
				[coordKey(to), toStep],
			]),
			tileCodes: new Map([
				[coordKey(from), fromCode],
				[coordKey(to), toCode],
			]),
		};
	}

	it("costs 1 for elevation delta 0", () => {
		expect(
			getTraversalStepCost(from, to, EdgeBarrier.None, terrain(0, 0)),
		).toBe(1);
	});

	it("costs 1 for elevation delta 1", () => {
		expect(
			getTraversalStepCost(from, to, EdgeBarrier.None, terrain(0, 1)),
		).toBe(1);
	});

	it("costs 1 for elevation delta 2", () => {
		expect(
			getTraversalStepCost(from, to, EdgeBarrier.None, terrain(0, 2)),
		).toBe(1);
	});

	it("costs 1 for elevation delta 3", () => {
		expect(
			getTraversalStepCost(from, to, EdgeBarrier.None, terrain(0, 3)),
		).toBe(1);
	});

	it("costs 2 for rough elevation delta 4", () => {
		expect(
			getTraversalStepCost(from, to, EdgeBarrier.None, terrain(0, 4)),
		).toBe(2);
	});

	it("rejects elevation delta 5", () => {
		expect(
			getTraversalStepCost(from, to, EdgeBarrier.None, terrain(0, 5)),
		).toBeNull();
	});

	it("treats Road -2 to Pavement 0 as normal graded movement", () => {
		expect(
			getTraversalStepCost(
				from,
				to,
				EdgeBarrier.None,
				terrain(-2, 0, EdgeMapTileCode.Road, EdgeMapTileCode.Pavement),
			),
		).toBe(1);
	});

	it("stair-to-stair delta 1 costs 1", () => {
		expect(
			getTraversalStepCost(
				from,
				to,
				EdgeBarrier.None,
				terrain(0, 1, EdgeMapTileCode.StairBottom, EdgeMapTileCode.StairStep),
			),
		).toBe(1);
	});

	it("rejects malformed stair-to-stair delta 2", () => {
		expect(
			getTraversalStepCost(
				from,
				to,
				EdgeBarrier.None,
				terrain(0, 2, EdgeMapTileCode.StairBottom, EdgeMapTileCode.StairStep),
			),
		).toBeNull();
	});

	it("adds the low-wall surcharge on flat terrain", () => {
		expect(
			getTraversalStepCost(from, to, EdgeBarrier.LowWall, terrain(0, 0)),
		).toBe(2);
	});

	it("low wall across a normal delta-3 grade costs 2 total", () => {
		expect(
			getTraversalStepCost(from, to, EdgeBarrier.LowWall, terrain(0, 3)),
		).toBe(2);
	});

	it("combines low-wall and rough delta-4 surcharges", () => {
		expect(
			getTraversalStepCost(from, to, EdgeBarrier.LowWall, terrain(0, 4)),
		).toBe(3);
	});

	it("ignoreElevationPenalty removes the rough-elevation surcharge", () => {
		const context = terrain(0, 4);

		context.profile = {
			ignoreElevationPenalty: true,
		};

		expect(getTraversalStepCost(from, to, EdgeBarrier.None, context)).toBe(1);
	});

	it("ignoreLowWallPenalty removes the low-wall surcharge", () => {
		const context = terrain(0, 0);

		context.profile = {
			ignoreLowWallPenalty: true,
		};

		expect(getTraversalStepCost(from, to, EdgeBarrier.LowWall, context)).toBe(
			1,
		);
	});

	it("a larger direct elevation profile permits a larger non-stair delta", () => {
		const context = terrain(0, 5);

		context.profile = {
			maxDirectElevationDeltaSteps: 5,
		};

		expect(getTraversalStepCost(from, to, EdgeBarrier.None, context)).toBe(2);
	});

	it.each([EdgeBarrier.FullWall, EdgeBarrier.Fence, EdgeBarrier.Glass])(
		"keeps hard barrier %s illegal",
		(barrier) => {
			expect(getTraversalStepCost(from, to, barrier, terrain(0, 0))).toBeNull();
		},
	);

	it("rejects non-cardinal path steps", () => {
		expect(
			getTraversalStepCost({ x: 0, y: 0 }, { x: 2, y: 0 }, EdgeBarrier.None),
		).toBeNull();
	});

	it("computes the cost of the exact supplied path", () => {
		const start = { x: 0, y: 0 };
		const path = [
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
		];

		const context: TerrainTraversalContext = {
			elevationSteps: new Map([
				["0,0", 0],
				["1,0", 2],
				["2,0", 2],
			]),
		};

		expect(computePathMovementCost(start, path, null, context)).toBe(2);
	});
});

describe("weighted movement range", () => {
	it("treats elevation through delta 3 as normal movement cost", () => {
		const grid = new Grid(3, 1);

		const edges = createEmptyEdgeGrid(3, 1);

		const terrain: TerrainTraversalContext = {
			elevationSteps: new Map([
				["0,0", 0],
				["1,0", 2],
				["2,0", 2],
			]),
		};

		const range = computeMovementRangeWithEdges(
			grid,
			edges,
			{ x: 0, y: 0 },
			2,
			new Set(),
			terrain,
		);

		expect(range.get("1,0")?.distance).toBe(1);
		expect(range.get("2,0")?.distance).toBe(2);
	});

	it("includes low-wall cost in Dijkstra distance", () => {
		const grid = new Grid(2, 1);
		const edges = createEmptyEdgeGrid(2, 1);

		setEdgeBetween(edges, { x: 0, y: 0 }, { x: 1, y: 0 }, EdgeBarrier.LowWall);

		const range = computeMovementRangeWithEdges(
			grid,
			edges,
			{ x: 0, y: 0 },
			2,
			new Set(),
		);

		expect(range.get("1,0")?.distance).toBe(2);
	});

	it("charges 2 movement for a rough elevation-delta-4 destination", () => {
		const grid = new Grid(2, 1);
		const edges = createEmptyEdgeGrid(2, 1);

		const terrain: TerrainTraversalContext = {
			elevationSteps: new Map([
				["0,0", 0],
				["1,0", 4],
			]),
		};

		const range = computeMovementRangeWithEdges(
			grid,
			edges,
			{ x: 0, y: 0 },
			2,
			new Set(),
			terrain,
		);

		expect(range.get("1,0")?.distance).toBe(2);
	});

	it("does not include an elevation-delta-5 destination", () => {
		const grid = new Grid(2, 1);
		const edges = createEmptyEdgeGrid(2, 1);

		const terrain: TerrainTraversalContext = {
			elevationSteps: new Map([
				["0,0", 0],
				["1,0", 5],
			]),
		};

		const range = computeMovementRangeWithEdges(
			grid,
			edges,
			{ x: 0, y: 0 },
			10,
			new Set(),
			terrain,
		);

		expect(range.has("1,0")).toBe(false);
	});
});
