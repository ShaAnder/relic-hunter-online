import {
	EdgeMapTileCode,
	groundMaterialId,
	type GroundMaterialId,
} from "@relic-hunter/shared";
import { RHO_MATERIAL_PALETTE } from "./RhoMaterialPalette";

export interface GroundMaterialDefinition {
	id: GroundMaterialId;
	label: string;
	/**
	 * Directory under assets/map/tiles used by the current asset set.
	 * Null means this material intentionally uses only its fallback colour.
	 */
	textureFolder: string | null;
	fallbackColor: number;
	/**
	 * Authoring constraint, not gameplay behaviour.
	 *
	 * It prevents obviously misleading combinations while still allowing more
	 * than one visual material for the same gameplay tile semantic.
	 */
	compatibleTileCodes: readonly EdgeMapTileCode[];
}

const defs: readonly GroundMaterialDefinition[] = [
	{
		id: groundMaterialId("floor.default"),
		label: "Floor",
		textureFolder: "floor",
		fallbackColor: 0xc8c8c8,
		compatibleTileCodes: [EdgeMapTileCode.Floor, EdgeMapTileCode.Pavement],
	},
	{
		id: groundMaterialId("pavement.default"),
		label: "Pavement",
		textureFolder: "pavement",
		fallbackColor: 0xaaaac8,
		compatibleTileCodes: [EdgeMapTileCode.Floor, EdgeMapTileCode.Pavement],
	},
	{
		id: groundMaterialId("road.default"),
		label: "Road",
		textureFolder: "road",
		fallbackColor: 0x66666f,
		compatibleTileCodes: [EdgeMapTileCode.Road],
	},
	{
		id: groundMaterialId("nature.default"),
		label: "Nature",
		textureFolder: "grass",
		fallbackColor: 0x96c850,
		compatibleTileCodes: [EdgeMapTileCode.Nature],
	},
	{
		id: groundMaterialId("river.default"),
		label: "River",
		textureFolder: "water",
		fallbackColor: 0xc8c8c8,
		compatibleTileCodes: [EdgeMapTileCode.River],
	},
	{
		id: groundMaterialId("stair.bottom.default"),
		label: "Stair Bottom",
		textureFolder: null,
		fallbackColor: 0x7a6a4a,
		compatibleTileCodes: [EdgeMapTileCode.StairBottom],
	},
	{
		id: groundMaterialId("stair.top.default"),
		label: "Stair Top",
		textureFolder: null,
		fallbackColor: 0x8a7a5a,
		compatibleTileCodes: [EdgeMapTileCode.StairTop],
	},
	{
		id: groundMaterialId("stair.step.default"),
		label: "Stair Step",
		textureFolder: null,
		fallbackColor: 0xc8c8c8,
		compatibleTileCodes: [EdgeMapTileCode.StairStep],
	},
	{
		id: groundMaterialId("stair.connector.default"),
		label: "Stair Connector",
		textureFolder: null,
		fallbackColor: 0xc8c8c8,
		compatibleTileCodes: [EdgeMapTileCode.StairConnector],
	},
	{
		id: groundMaterialId("ladder.bottom.default"),
		label: "Ladder Bottom",
		textureFolder: null,
		fallbackColor: 0x5a4a3a,
		compatibleTileCodes: [EdgeMapTileCode.LadderBottom],
	},
	{
		id: groundMaterialId("ladder.top.default"),
		label: "Ladder Top",
		textureFolder: null,
		fallbackColor: 0x6a5a4a,
		compatibleTileCodes: [EdgeMapTileCode.LadderTop],
	},
	{
		id: groundMaterialId("floor.stone.warm"),
		label: "Warm Stone",
		textureFolder: "style-lock/stone-warm",
		fallbackColor: RHO_MATERIAL_PALETTE.stoneMid,
		compatibleTileCodes: [EdgeMapTileCode.Floor, EdgeMapTileCode.Pavement],
	},
	{
		id: groundMaterialId("road.earth.warm"),
		label: "Warm Earth Road",
		textureFolder: "style-lock/earth-road-warm",
		fallbackColor: RHO_MATERIAL_PALETTE.earthBase,
		compatibleTileCodes: [EdgeMapTileCode.Road],
	},
	{
		id: groundMaterialId("nature.grass.warm"),
		label: "Warm Grass",
		textureFolder: "style-lock/grass-warm",
		fallbackColor: RHO_MATERIAL_PALETTE.grassBase,
		compatibleTileCodes: [EdgeMapTileCode.Nature],
	},
	{
		id: groundMaterialId("river.water.cool"),
		label: "Cool Water",
		textureFolder: "style-lock/water-cool",
		fallbackColor: RHO_MATERIAL_PALETTE.waterBase,
		compatibleTileCodes: [EdgeMapTileCode.River],
	},
];

const byId = new Map<GroundMaterialId, GroundMaterialDefinition>(
	defs.map((def) => [def.id, def]),
);

const defaultByTileCode = new Map<EdgeMapTileCode, GroundMaterialId>([
	[EdgeMapTileCode.Floor, groundMaterialId("floor.default")],
	[EdgeMapTileCode.Pavement, groundMaterialId("pavement.default")],
	[EdgeMapTileCode.Road, groundMaterialId("road.default")],
	[EdgeMapTileCode.Nature, groundMaterialId("nature.default")],
	[EdgeMapTileCode.River, groundMaterialId("river.default")],
	[EdgeMapTileCode.StairBottom, groundMaterialId("stair.bottom.default")],
	[EdgeMapTileCode.StairTop, groundMaterialId("stair.top.default")],
	[EdgeMapTileCode.StairStep, groundMaterialId("stair.step.default")],
	[EdgeMapTileCode.StairConnector, groundMaterialId("stair.connector.default")],
	[EdgeMapTileCode.LadderBottom, groundMaterialId("ladder.bottom.default")],
	[EdgeMapTileCode.LadderTop, groundMaterialId("ladder.top.default")],
]);

export function allGroundMaterials(): readonly GroundMaterialDefinition[] {
	return defs;
}

export function groundMaterialDefinition(
	id: GroundMaterialId,
): GroundMaterialDefinition {
	const definition = byId.get(id);
	if (!definition) {
		throw new Error(`Unknown ground material: ${id}`);
	}
	return definition;
}

export function defaultGroundMaterialId(
	code: EdgeMapTileCode,
): GroundMaterialId {
	const id = defaultByTileCode.get(code);
	if (!id) {
		throw new Error(`No default ground material for tile code ${code}`);
	}

	return id;
}

export function resolveGroundMaterial(
	code: EdgeMapTileCode,
	authored: GroundMaterialId | undefined,
): GroundMaterialDefinition {
	const id = authored ?? defaultGroundMaterialId(code);
	const definition = groundMaterialDefinition(id);
	if (!definition.compatibleTileCodes.includes(code)) {
		throw new Error(
			`Ground material ${id} is not compatible with tile code ${code}`,
		);
	}

	return definition;
}
