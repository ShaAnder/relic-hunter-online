import { describe, expect, it } from "vitest";
import { Grid, TileType, coordKey } from "../grid";
import { computeMovementRange, getPathTo } from "../movement";

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
