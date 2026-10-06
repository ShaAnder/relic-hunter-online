import {
	EdgeMapTileCode,
	groundMaterialId,
	type GroundMaterialId,
} from "@relic-hunter/shared";
import { RHO_MATERIAL_PALETTE } from "./RhoMaterialPalette";

export interface GroundMaterialDefinition {
	id: GroundMaterialId;
	label: string;
	textureFolder: string | null;
	fallbackColor: number;
	compatibleTileCodes: readonly EdgeMapTileCode[];

	sampling?: GroundSamplingDefinition;
	variation?: GroundVariationDefinition;
	edgeTreatment?: GroundEdgeTreatmentDefinition;
	animation?: GroundAnimationDefinition;
}

export type GroundSamplingDefinition =
	| {
			kind: "tile";
	  }
	| {
			kind: "surface-repeat";
			/**
			 * Number of logical cells covered by one complete texture repeat.
			 * means the pattern repeats every 4x4 logical cells rather than
			 * restarting inside every cell.
			 */
			repeatTilesX: number;
			repeatTilesY: number;
	  };

export interface GroundVariationDefinition {
	/**
	 * Optional weight per lexically sorted base texture.
	 *
	 * Tile-reset materials may use weighted whole-texture variants.
	 * Continuous materials should normally use one base texture first so
	 * pattern continuity is not broken at cell boundaries.
	 */
	weights?: readonly number[];
}

export type GroundEdgeTreatmentDefinition =
	| {
			kind: "overlay";
			// Transparent RGBA overlays named by same-surface topology mask
			textureFolder: string;
	  }
	| {
			kind: "coverage";
			// Greyscale/RGBA coverage masks named:
			maskFolder: string;
			// Renderer-neutral material rendered below the primary material.
			underlayMaterialId: GroundMaterialId;
	  };

export interface GroundAnimationDefinition {
	kind: "flow";
	/** Texture-repeat cycles per second at unit authored flow. */
	speed: number;
	/** Environmental wind contribution to UV movement. */
	windInfluence: number;
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
		id: groundMaterialId("pavement.flagstone.warm"),
		label: "Warm Flagstone",
		textureFolder: "pavement/flagstone-warm/base",
		fallbackColor: RHO_MATERIAL_PALETTE.stoneMid,
		compatibleTileCodes: [EdgeMapTileCode.Floor, EdgeMapTileCode.Pavement],
		sampling: {
			kind: "surface-repeat",
			repeatTilesX: 4,
			repeatTilesY: 4,
		},
		edgeTreatment: {
			kind: "overlay",
			textureFolder: "pavement/flagstone-warm/topology",
		},
	},
	{
		id: groundMaterialId("road.earth.warm"),
		label: "Warm Earth Road",
		textureFolder: "style-lock/earth-road-warm",
		fallbackColor: RHO_MATERIAL_PALETTE.earthBase,
		compatibleTileCodes: [EdgeMapTileCode.Road],
	},
	{
		id: groundMaterialId("nature.soil.warm"),
		label: "Warm Soil",
		textureFolder: "nature/soil-warm/base",
		fallbackColor: RHO_MATERIAL_PALETTE.earthBase,
		compatibleTileCodes: [EdgeMapTileCode.Nature],
		sampling: {
			kind: "surface-repeat",
			repeatTilesX: 4,
			repeatTilesY: 4,
		},
	},
	{
		id: groundMaterialId("nature.grass.warm"),
		label: "Warm Grass",
		textureFolder: "nature/grass-warm/base",
		fallbackColor: RHO_MATERIAL_PALETTE.grassBase,
		compatibleTileCodes: [EdgeMapTileCode.Nature],
		sampling: {
			kind: "surface-repeat",
			repeatTilesX: 4,
			repeatTilesY: 4,
		},
		edgeTreatment: {
			kind: "coverage",
			maskFolder: "nature/grass-warm/coverage-masks",
			underlayMaterialId: groundMaterialId("nature.soil.warm"),
		},
	},
	{
		id: groundMaterialId("river.water.cool"),
		label: "Cool Water",
		textureFolder: "water/cool/base",
		fallbackColor: RHO_MATERIAL_PALETTE.waterBase,
		compatibleTileCodes: [EdgeMapTileCode.River],
		sampling: {
			kind: "surface-repeat",
			repeatTilesX: 4,
			repeatTilesY: 4,
		},
		animation: {
			kind: "flow",
			speed: 0.08,
			windInfluence: 0.2,
		},
	},
];

const byId = new Map<GroundMaterialId, GroundMaterialDefinition>(
	defs.map((def) => [def.id, def]),
);

function validateGroundMaterialDefinition(
	definition: GroundMaterialDefinition,
): void {
	const sampling = groundSampling(definition);
	if (sampling.kind === "surface-repeat") {
		if (
			!Number.isFinite(sampling.repeatTilesX) ||
			!Number.isFinite(sampling.repeatTilesY) ||
			sampling.repeatTilesX <= 0 ||
			sampling.repeatTilesY <= 0
		) {
			throw new Error(
				`Ground material ${definition.id} has invalid surface-repeat scale`,
			);
		}
	}
	if (definition.variation?.weights) {
		for (const weight of definition.variation.weights) {
			if (!Number.isFinite(weight) || weight <= 0) {
				throw new Error(
					`Ground material ${definition.id} has an invalid variant weight`,
				);
			}
		}
	}
	if (definition.animation) {
		if (
			!Number.isFinite(definition.animation.speed) ||
			!Number.isFinite(definition.animation.windInfluence)
		) {
			throw new Error(
				`Ground material ${definition.id} has invalid animation values`,
			);
		}
	}
	if (
		definition.edgeTreatment?.kind === "coverage" &&
		definition.edgeTreatment.underlayMaterialId === definition.id
	) {
		throw new Error(
			`Ground material ${definition.id} cannot use itself as a coverage underlay`,
		);
	}
}

for (const definition of defs) {
	validateGroundMaterialDefinition(definition);
}

for (const definition of defs) {
	const treatment = definition.edgeTreatment;
	if (treatment?.kind !== "coverage") {
		continue;
	}
	const underlay = byId.get(treatment.underlayMaterialId);
	if (!underlay) {
		throw new Error(
			`Ground material ${definition.id} references unknown underlay ${treatment.underlayMaterialId}`,
		);
	}
	if (underlay.edgeTreatment?.kind === "coverage") {
		throw new Error(
			`Coverage underlay ${underlay.id} must not itself use coverage in Phase 12`,
		);
	}
}

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

export function groundSampling(
	definition: GroundMaterialDefinition,
): GroundSamplingDefinition {
	return (
		definition.sampling ?? {
			kind: "tile",
		}
	);
}

export function groundAnimation(
	definition: GroundMaterialDefinition,
): GroundAnimationDefinition | null {
	return definition.animation ?? null;
}

export function groundEdgeTreatment(
	definition: GroundMaterialDefinition,
): GroundEdgeTreatmentDefinition | null {
	return definition.edgeTreatment ?? null;
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
