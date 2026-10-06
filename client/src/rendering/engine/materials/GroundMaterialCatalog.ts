import {
	EdgeMapTileCode,
	groundMaterialId,
	type GridCoord,
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

export type GroundSurfaceWrapMode = "repeat" | "mirror";

export type GroundSurfaceVariantTransform =
	| "none"
	| "mirror"
	| "rotate90"
	| "rotate180"
	| "rotate270";

export type GroundSamplingDefinition =
	| {
			kind: "tile";
	  }
	| {
			kind: "surface-repeat";
			repeatTilesX: number;
			repeatTilesY: number;
			wrap?: GroundSurfaceWrapMode;

			/**
			 * Optional atlas variants for this structured material.
			 * Example:
			 *     flagstone_a.png
			 *     flagstone_b.png
			 *     flagstone_c.png
			 *     flagstone_d.png
			 */
			variantCount?: number;

			/**
			 * Logical size of one stable selection region.
			 * All logical cells inside the same domain choose the same base variant.
			 */
			variantDomainTilesX?: number;
			variantDomainTilesY?: number;

			/**
			 * Allowed orientation transforms for the chosen variant.
			 * Keep this conservative. Structured contained-stone tiles can safely
			 * allow rotations and mirrors; other materials may opt out.
			 */
			allowMirrorX?: boolean;
			allowMirrorY?: boolean;
			allowRotate90?: boolean;
	  };

export interface GroundStableVariantDomainDefinition {
	/**
	 * Logical size of one deterministic variant-selection region.
	 *
	 * A 1x1 domain means every logical tile may choose a different variant.
	 * Larger domains keep one variant across a wider continuous area.
	 */
	tilesX: number;
	tilesY: number;
}

export interface GroundVariationDefinition {
	/**
	 * Optional weight per lexically sorted base texture.
	 *
	 * With no weights, all discovered variants have equal probability.
	 */
	weights?: readonly number[];

	/**
	 * Stable coordinate domain used when choosing a base variant.
	 *
	 * Variant choice remains deterministic from:
	 *     map seed + floor + domain coordinate
	 *
	 * rather than depending on runtime order or frame state.
	 */
	stableDomain?: GroundStableVariantDomainDefinition;
}

export type GroundEdgeTreatmentDefinition =
	| {
			/**
			 * Structured border assembled from one canonical directional edge.
			 *
			 * The shader rotates the primitive based on exposed N/E/S/W sides.
			 */
			kind: "border";
			textureFolder: string;
	  }
	| {
			/**
			 * Organic coverage remains a fully authored 4-bit mask set.
			 */
			kind: "coverage";
			maskFolder: string;
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
		/**
		 * Each of the new flagstone_warm_0x assets is one complete,
		 * self-contained logical repeat.
		 */
		sampling: {
			kind: "surface-repeat",
			repeatTilesX: 1,
			repeatTilesY: 1,

			/**
			 * Keep the existing cheap reflected repetition in addition
			 * to choosing among the four source variants.
			 */
			wrap: "mirror",
		},
		variation: {
			/**
			 * One stable selection domain per logical tile.
			 *
			 * This is safe for this asset family because stones are authored
			 * completely inside each square and terminate at grout boundaries.
			 */
			stableDomain: {
				tilesX: 1,
				tilesY: 1,
			},
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

	const stableDomain = definition.variation?.stableDomain;

	if (stableDomain) {
		if (
			!Number.isInteger(stableDomain.tilesX) ||
			!Number.isInteger(stableDomain.tilesY) ||
			stableDomain.tilesX <= 0 ||
			stableDomain.tilesY <= 0
		) {
			throw new Error(
				`Ground material ${definition.id} has an invalid stable variant domain`,
			);
		}

		if (sampling.kind !== "surface-repeat") {
			throw new Error(
				`Ground material ${definition.id} uses a stable variant domain but is not surface-repeat`,
			);
		}

		/**
		 * Variant boundaries must land on complete texture repeats.
		 *
		 * Otherwise a variant could change halfway through one continuous repeat,
		 * producing exactly the kind of visual seam this system exists to avoid.
		 */
		const repeatsPerDomainX = stableDomain.tilesX / sampling.repeatTilesX;
		const repeatsPerDomainY = stableDomain.tilesY / sampling.repeatTilesY;

		if (
			!Number.isInteger(repeatsPerDomainX) ||
			!Number.isInteger(repeatsPerDomainY) ||
			repeatsPerDomainX < 1 ||
			repeatsPerDomainY < 1
		) {
			throw new Error(
				`Ground material ${definition.id} stable variant domain must contain whole texture repeats`,
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

/**
 * Return the coordinate used to seed deterministic material variation.
 *
 * Materials without a stable domain retain the original per-tile behaviour.
 * Structured surfaces can group logical tiles into larger domains without
 * introducing a material-specific renderer algorithm.
 */
export function groundVariantDomainCoord(
	definition: GroundMaterialDefinition,
	coord: GridCoord,
): GridCoord {
	const domain = definition.variation?.stableDomain;

	if (!domain) {
		return coord;
	}

	return {
		x: Math.floor(coord.x / domain.tilesX),
		y: Math.floor(coord.y / domain.tilesY),
	};
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
