import { BlueprintCode } from "./blueprint";
import type { BuildingTemplate } from "./buildingTemplate";

const F = BlueprintCode.Floor;
const W = BlueprintCode.Wall;
const I = BlueprintCode.InteractableMarker;

/**
 * A small corner shop — 7x5, door on the south wall. A counter sits
 * against the far wall facing the entrance (the classic "you walk in,
 * the counter's right there" layout), with two interactable marker
 * spots for whatever the match's actual item system wants to spawn.
 * Rows are written top-to-bottom to match how the layout actually
 * reads; blueprint rows are y-major so this literally is
 * cornerShopBlueprint[y][x].
 */
const cornerShopBlueprint = [
	[W, W, W, W, W, W, W],
	[W, F, F, F, F, F, W],
	[W, F, I, F, I, F, W],
	[W, F, F, F, F, F, W],
	[W, W, W, F, W, W, W],
];

export const cornerShop: BuildingTemplate = {
	name: "corner-shop",
	blueprint: cornerShopBlueprint,
	door: { coord: { x: 3, y: 4 }, facing: "south" },
	props: [{ coord: { x: 3, y: 1 }, propType: "counter" }],
};

/**
 * A plain 5x5 single-room building with no fixed props — pure filler
 * for map variety, not every building needs to be a named, decorated
 * space. Door on the south wall, one interactable marker.
 */
const genericSmallBlueprint = [
	[W, W, W, W, W],
	[W, F, F, F, W],
	[W, F, I, F, W],
	[W, F, F, F, W],
	[W, W, F, W, W],
];

export const genericSmallBuilding: BuildingTemplate = {
	name: "generic-small",
	blueprint: genericSmallBlueprint,
	door: { coord: { x: 2, y: 4 }, facing: "south" },
	props: [],
};

/** Every template currently authored — placeBuildings picks from this list. Add new templates here as they're built; nothing else needs to change. */
export const ALL_BUILDING_TEMPLATES: BuildingTemplate[] = [
	cornerShop,
	genericSmallBuilding,
];
