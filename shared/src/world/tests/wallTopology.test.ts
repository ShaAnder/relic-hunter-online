import { describe, expect, it } from "vitest";
import { Grid } from "../grid";
import { EdgeBarrier, createEmptyEdgeGrid, setEdgeBetween } from "../edgeGrid";
import type { CompiledEdgeMap } from "../maps/edgeMapCompiler";
import {
	edgeFoundationHeight,
	edgeSupportHeight,
	resolveWallJunctionHeight,
	structuralEdgeForTilePair,
} from "../maps/wallTopology";

function makeMap(elevations: Record<string, number>): CompiledEdgeMap {
	const grid = new Grid(2, 2);
	const edges = createEmptyEdgeGrid(2, 2);
	return {
		grid,
		edges,
		tileCodes: new Map(),
		elevationSteps: new Map(),
		elevation: new Map(Object.entries(elevations)),
	};
}

describe("wall topology elevation", () => {
	it("ignores a diagonally touching high tile with no incident structural edge", () => {
		const map = makeMap({
			"0,0": 0.4,
			"1,0": 0,
			"0,1": 0,
			"1,1": 0,
		});
		const a = {
			x: 0,
			y: 1,
		};
		const b = {
			x: 1,
			y: 1,
		};
		setEdgeBetween(map.edges, a, b, EdgeBarrier.FullWall);
		const edge = structuralEdgeForTilePair(a, b, EdgeBarrier.FullWall)!;
		expect(
			resolveWallJunctionHeight(map, edge, {
				x: 1,
				y: 1,
			}),
		).toBe(0);
	});
	it("raises a junction when a genuinely connected high-supported wall meets it", () => {
		const map = makeMap({
			"0,0": 0.4,
			"1,0": 0,
			"0,1": 0,
			"1,1": 0,
		});
		const lowerA = {
			x: 0,
			y: 1,
		};
		const lowerB = {
			x: 1,
			y: 1,
		};
		setEdgeBetween(map.edges, lowerA, lowerB, EdgeBarrier.FullWall);
		setEdgeBetween(
			map.edges,
			{
				x: 0,
				y: 0,
			},
			{
				x: 1,
				y: 0,
			},
			EdgeBarrier.FullWall,
		);
		const edge = structuralEdgeForTilePair(
			lowerA,
			lowerB,
			EdgeBarrier.FullWall,
		)!;
		expect(
			resolveWallJunctionHeight(map, edge, {
				x: 1,
				y: 1,
			}),
		).toBe(0.4);
	});
	it("keeps support and foundation local to the current wall edge", () => {
		const map = makeMap({
			"0,0": 0,
			"1,0": -0.2,
			"0,1": 0,
			"1,1": 0,
		});
		const a = {
			x: 0,
			y: 0,
		};
		const b = {
			x: 1,
			y: 0,
		};
		setEdgeBetween(map.edges, a, b, EdgeBarrier.FullWall);
		const edge = structuralEdgeForTilePair(a, b, EdgeBarrier.FullWall)!;
		expect(edgeSupportHeight(map, edge)).toBe(0);
		expect(edgeFoundationHeight(map, edge)).toBe(-0.2);
	});
});
