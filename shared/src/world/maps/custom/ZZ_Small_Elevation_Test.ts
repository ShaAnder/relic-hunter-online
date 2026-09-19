/**
 * ZZ Small Elevation Test
 *
 * Very small/dev-only custom map for fast elevation testing.
 * Designed to be simpler than the larger ZZ_Elevation_Test map.
 *
 * Layout:
 * - 20x20 logical map
 * - big flat outer floor so spawning/camera still work normally
 * - one small room in the center
 * - inside the room:
 *   - a simple 0 -> +1 -> +2 -> +3 stair run
 *   - a small elevated platform
 *   - one road/pavement strip outside for curb testing
 *
 * Purpose:
 * - quick wall-height tests
 * - quick terrain-side/foundation tests
 * - quick movement/traversal tests later
 */

import { EdgeBarrier } from "../../edgeGrid";
import { EdgeMapTileCode } from "../edgeMapCompiler";
import type { MapFloorDefinition } from "../mapBundle";

export const ZZ_Small_Elevation_Test_NAME = "ZZ Small Elevation Test";

const LOGICAL_SIZE = 20;
const BLUEPRINT_SIZE = LOGICAL_SIZE * 2 - 1;

function makeBlankBlueprint(): number[][] {
	return Array.from(
		{ length: BLUEPRINT_SIZE },
		() => new Array<number>(BLUEPRINT_SIZE).fill(0),
	);
}

function setTile(
	blueprint: number[][],
	x: number,
	y: number,
	code: EdgeMapTileCode,
): void {
	blueprint[2 * y][2 * x] = code;
}

function fillTiles(
	blueprint: number[][],
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	code: EdgeMapTileCode,
): void {
	for (let y = y1; y <= y2; y++) {
		for (let x = x1; x <= x2; x++) {
			setTile(blueprint, x, y, code);
		}
	}
}

function setEdgeBetween(
	blueprint: number[][],
	ax: number,
	ay: number,
	bx: number,
	by: number,
	barrier: EdgeBarrier,
): void {
	if (ay === by && Math.abs(ax - bx) === 1) {
		const leftX = Math.min(ax, bx);
		blueprint[2 * ay][2 * leftX + 1] = barrier;
		return;
	}

	if (ax === bx && Math.abs(ay - by) === 1) {
		const topY = Math.min(ay, by);
		blueprint[2 * topY + 1][2 * ax] = barrier;
		return;
	}

	throw new Error(
		`ZZ Small Elevation Test: edge endpoints must be cardinally adjacent: ` +
			`(${ax},${ay}) -> (${bx},${by})`,
	);
}

function buildGroundBlueprint(): number[][] {
	const blueprint = makeBlankBlueprint();

	// Large flat outer area.
	fillTiles(
		blueprint,
		1,
		1,
		18,
		18,
		EdgeMapTileCode.Floor,
	);

	// Simple curb strip outside for Road/Pavement testing.
	fillTiles(
		blueprint,
		2,
		15,
		6,
		15,
		EdgeMapTileCode.Pavement,
	);
	fillTiles(
		blueprint,
		2,
		16,
		6,
		16,
		EdgeMapTileCode.Road,
	);
	for (let x = 2; x <= 6; x++) {
		setEdgeBetween(
			blueprint,
			x,
			15,
			x,
			16,
			EdgeBarrier.FullWall,
		);
	}

	// Central room: x 7..12, y 7..12
	// Walls around perimeter, doorway at bottom center.
	for (let x = 7; x <= 12; x++) {
		setEdgeBetween(blueprint, x, 7, x, 6, EdgeBarrier.FullWall);   // north
		setEdgeBetween(blueprint, x, 12, x, 13, EdgeBarrier.FullWall); // south
	}
	for (let y = 7; y <= 12; y++) {
		setEdgeBetween(blueprint, 7, y, 6, y, EdgeBarrier.FullWall);   // west
		setEdgeBetween(blueprint, 12, y, 13, y, EdgeBarrier.FullWall); // east
	}

	// Door opening at bottom center.
	setEdgeBetween(blueprint, 9, 12, 9, 13, EdgeBarrier.None);
	setEdgeBetween(blueprint, 10, 12, 10, 13, EdgeBarrier.None);

	// Stair run inside room: 0 -> +1 -> +2 -> +3
	setTile(blueprint, 8, 9, EdgeMapTileCode.StairBottom);
	setTile(blueprint, 9, 9, EdgeMapTileCode.StairStep);
	setTile(blueprint, 10, 9, EdgeMapTileCode.StairStep);
	setTile(blueprint, 11, 9, EdgeMapTileCode.StairTop);

	// Small elevated platform behind the stair top.
	setTile(blueprint, 10, 8, EdgeMapTileCode.Floor);
	setTile(blueprint, 11, 8, EdgeMapTileCode.Floor);
	setTile(blueprint, 10, 7, EdgeMapTileCode.Floor);
	setTile(blueprint, 11, 7, EdgeMapTileCode.Floor);

	// Optional inner wall line to help test sloped/raised wall rendering.
	setEdgeBetween(blueprint, 10, 8, 10, 7, EdgeBarrier.FullWall);
	setEdgeBetween(blueprint, 11, 8, 11, 7, EdgeBarrier.FullWall);

	return blueprint;
}

const GROUND_BLUEPRINT = buildGroundBlueprint();

export const ZZ_Small_Elevation_Test_FLOORS: MapFloorDefinition[] = [
	{
		blueprint: GROUND_BLUEPRINT,
		elevationSteps: {
			// Stair run
			"9,9": 1,
			"10,9": 2,
			"11,9": 3,

			// Elevated platform behind stair top
			"10,8": 3,
			"11,8": 3,
			"10,7": 3,
			"11,7": 3,
		},
	},
];

export const ZZ_Small_Elevation_Test_GROUND_FLOOR_INDEX = 0;
