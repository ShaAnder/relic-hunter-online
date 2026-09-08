import type { GridCoord } from "./grid";
import type { RandomFn } from "../math/random";
import {
	type MapBlueprint,
	BlueprintCode,
	blueprintWidth,
	blueprintHeight,
	getCode,
	inBounds,
} from "./blueprint";
import { rotateBlueprint90, rotateCoord90, stampBlueprint } from "./blueprintTransform";

export type DoorFacing = "north" | "south" | "east" | "west";

/** A fixed, named prop — a counter, a fireplace, a shelf. Never randomized; a template author places these once and they always generate exactly where placed, since rotation moves the whole template as one rigid piece. What propType actually renders as is decided entirely outside this system, same as marker codes. */
export interface TemplateProp {
	coord: GridCoord;
	propType: string;
}

/**
 * A hand-authored building — the whole point of building this as
 * prefab content rather than procedurally carving building interiors:
 * a human designs the room once (walls, door, props) and it generates
 * exactly that way every time, just at a random position/rotation.
 * All coordinates (blueprint cells, door, each prop) are defined in
 * this template's own local space — never the world map's.
 */
export interface BuildingTemplate {
	name: string;
	blueprint: MapBlueprint;
	/** Where the entrance is, in local coordinates, and which direction it opens toward — the tile immediately beyond the door in that direction must be existing walkable ground (an alley) for this template to be placeable there. */
	door: { coord: GridCoord; facing: DoorFacing };
	props: TemplateProp[];
}

const FACING_ROTATION_ORDER: DoorFacing[] = ["north", "east", "south", "west"];

function rotateFacing90(facing: DoorFacing): DoorFacing {
	const idx = FACING_ROTATION_ORDER.indexOf(facing);
	return FACING_ROTATION_ORDER[(idx + 1) % 4];
}

const FACING_DELTA: Record<DoorFacing, GridCoord> = {
	north: { x: 0, y: -1 },
	south: { x: 0, y: 1 },
	east: { x: 1, y: 0 },
	west: { x: -1, y: 0 },
};

/**
 * Rotates an entire template 90 degrees clockwise — blueprint, door,
 * and every prop together, through the same transform. This is the
 * actual guarantee that makes prefab buildings reliable: nothing
 * inside a template ever moves relative to anything else inside it,
 * because rotation is one operation applied to the whole rigid piece,
 * never something recomputed per-element that could drift.
 */
export function rotateTemplate90(template: BuildingTemplate): BuildingTemplate {
	const sourceHeight = blueprintHeight(template.blueprint);
	return {
		name: template.name,
		blueprint: rotateBlueprint90(template.blueprint),
		door: {
			coord: rotateCoord90(template.door.coord, sourceHeight),
			facing: rotateFacing90(template.door.facing),
		},
		props: template.props.map((p) => ({
			coord: rotateCoord90(p.coord, sourceHeight),
			propType: p.propType,
		})),
	};
}

/** Applies 0–3 quarter-turns, chosen at random, to a template. */
export function randomlyRotateTemplate(
	template: BuildingTemplate,
	random: RandomFn,
): BuildingTemplate {
	const turns = Math.floor(random() * 4);
	let result = template;
	for (let i = 0; i < turns; i++) result = rotateTemplate90(result);
	return result;
}

/**
 * Checks whether a template's footprint fits at `at` in `target`
 * without overlapping any existing floor — walls of a new building are
 * allowed to sit against existing walls (the world starts as all
 * wall), but not against anything already carved as floor, since that
 * would mean cutting into an alley or another building. Also requires
 * the door's outward-facing neighbor to already be floor, so the
 * building is actually reachable rather than sealed off.
 */
export function templateFits(
	target: MapBlueprint,
	template: BuildingTemplate,
	at: GridCoord,
): boolean {
	const w = blueprintWidth(template.blueprint);
	const h = blueprintHeight(template.blueprint);

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const dest = { x: at.x + x, y: at.y + y };
			if (!inBounds(target, dest)) return false;
			if (getCode(target, dest) !== BlueprintCode.Wall) return false;
		}
	}

	const doorWorld = { x: at.x + template.door.coord.x, y: at.y + template.door.coord.y };
	const delta = FACING_DELTA[template.door.facing];
	const outward = { x: doorWorld.x + delta.x, y: doorWorld.y + delta.y };
	if (!inBounds(target, outward)) return false;
	if (getCode(target, outward) === BlueprintCode.Wall) return false;

	return true;
}

/** The result of successfully placing one template — its final world position and (rotated) props, for whatever later system spawns the actual prop content. */
export interface PlacedBuilding {
	name: string;
	origin: GridCoord;
	props: { coord: GridCoord; propType: string }[];
}

/**
 * Tries to place each given template somewhere in `target`'s existing
 * wall space, at a random rotation and position, retrying until a
 * valid spot is found or attempts run out for that template. Stamps
 * successfully-placed templates directly into `target`. Templates
 * that never find a valid spot are simply skipped — not every
 * building needs to fit on every map.
 */
export function placeBuildings(
	target: MapBlueprint,
	templates: BuildingTemplate[],
	random: RandomFn,
	attemptsPerTemplate = 60,
): PlacedBuilding[] {
	const placed: PlacedBuilding[] = [];
	const width = blueprintWidth(target);
	const height = blueprintHeight(target);

	for (const template of templates) {
		let success = false;
		for (let attempt = 0; attempt < attemptsPerTemplate && !success; attempt++) {
			const rotated = randomlyRotateTemplate(template, random);
			const w = blueprintWidth(rotated.blueprint);
			const h = blueprintHeight(rotated.blueprint);
			if (w >= width || h >= height) continue;

			const at = {
				x: Math.floor(random() * (width - w)),
				y: Math.floor(random() * (height - h)),
			};

			if (!templateFits(target, rotated, at)) continue;

			stampBlueprint(target, rotated.blueprint, at);
			placed.push({
				name: rotated.name,
				origin: at,
				props: rotated.props.map((p) => ({
					coord: { x: at.x + p.coord.x, y: at.y + p.coord.y },
					propType: p.propType,
				})),
			});
			success = true;
		}
	}

	return placed;
}
