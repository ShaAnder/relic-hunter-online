import { Texture } from "pixi.js";
import type { Texture as PixiTexture } from "pixi.js";
import type { VisualMaterialRef } from "../materials/MaterialKey";
import {
	resolveGroundAtlasRegion,
	resolveGroundEdgeAtlasRegion,
} from "../materials/mapMaterialFactory";
import {
	materialBatchKey,
	type MaterialBatchKey,
} from "../batching/MaterialBatchKey";
import { resolveBarrierMaterial } from "../materials/barrierMaterialFactory";
import {
	groundAnimation,
	groundEdgeTreatment,
	groundMaterialDefinition,
	groundSampling,
} from "../materials/GroundMaterialCatalog";
import {
	GROUND_EDGE_BORDER,
	GROUND_EDGE_COVERAGE,
	GROUND_EDGE_NONE,
	GROUND_SAMPLING_SURFACE_REPEAT,
	GROUND_SAMPLING_TILE,
	GROUND_WRAP_MIRROR,
	GROUND_WRAP_REPEAT,
} from "../materials/GroundMaterialGpuCodes";

export interface GroundGpuLayer {
	atlasRect: readonly [number, number, number, number];
	samplingMode: number;
	repeatTilesX: number;
	repeatTilesY: number;
	wrapMode: number;
}

export interface ResolvedGroundGpuMaterial {
	batchKey: MaterialBatchKey;
	texture: PixiTexture;
	usesTexture: true;
	fallbackColor: number;

	primary: GroundGpuLayer;
	underlay: GroundGpuLayer | null;

	edgeAtlasRect: readonly [number, number, number, number] | null;
	edgeMode: number;

	animationSpeed: number;
	windInfluence: number;
}

export interface ResolvedStaticWorldGpuMaterial {
	batchKey: MaterialBatchKey;
	texture: PixiTexture;
	usesTexture: boolean;
	fallbackColor: number;
	alpha: number;
}

/**
 * Runtime bridge from backend-neutral material references to Pixi resources.
 *
 * The compiler decides WHICH semantic variant a surface needs. This class is
 * allowed to know about Pixi because its job is resolving that decision into
 * actual GPU resources.
 */
export class GpuMaterialLibrary {
	/**
	 * Every ground tile now resolves into the same atlas-backed GPU material.
	 * Texture variation is represented by UVs rather than separate batches.
	 */
	private readonly groundAtlasBatchKey = materialBatchKey(
		"tile:shared-atlas:normal:ground",
	);

	private readonly worldCache = new Map<
		MaterialBatchKey,
		ResolvedStaticWorldGpuMaterial
	>();

	private resolveGroundLayer(
		materialId: import("@relic-hunter/shared").GroundMaterialId,
		variantHash: number,
	): GroundGpuLayer {
		const definition = groundMaterialDefinition(materialId);
		const sampling = groundSampling(definition);
		const region = resolveGroundAtlasRegion(materialId, variantHash);
		const wrapMode =
			sampling.kind === "surface-repeat" && sampling.wrap === "mirror"
				? GROUND_WRAP_MIRROR
				: GROUND_WRAP_REPEAT;

		return {
			atlasRect: [region.u0, region.v0, region.u1, region.v1],
			samplingMode:
				sampling.kind === "surface-repeat"
					? GROUND_SAMPLING_SURFACE_REPEAT
					: GROUND_SAMPLING_TILE,

			repeatTilesX:
				sampling.kind === "surface-repeat" ? sampling.repeatTilesX : 1,
			repeatTilesY:
				sampling.kind === "surface-repeat" ? sampling.repeatTilesY : 1,
			wrapMode,
		};
	}

	resolveGround(
		material: VisualMaterialRef,
		sameSurfaceMask: number,
	): ResolvedGroundGpuMaterial {
		if (material.kind !== "tile") {
			throw new Error(
				`GpuMaterialLibrary.resolveGround: expected tile material, received ${material.kind}`,
			);
		}

		const definition = groundMaterialDefinition(material.materialId);
		const treatment = groundEdgeTreatment(definition);
		const animation = groundAnimation(definition);

		const primary = this.resolveGroundLayer(
			material.materialId,
			material.variantHash,
		);

		let underlay: GroundGpuLayer | null = null;

		if (treatment?.kind === "coverage") {
			underlay = this.resolveGroundLayer(treatment.underlayMaterialId, 0);
		}

		const edgeRegion = treatment
			? resolveGroundEdgeAtlasRegion(material.materialId, sameSurfaceMask)
			: null;

		const edgeMode =
			treatment?.kind === "border"
				? GROUND_EDGE_BORDER
				: treatment?.kind === "coverage"
					? GROUND_EDGE_COVERAGE
					: GROUND_EDGE_NONE;

		return {
			batchKey: this.groundAtlasBatchKey,
			texture: resolveGroundAtlasRegion(
				material.materialId,
				material.variantHash,
			).texture,
			usesTexture: true,
			fallbackColor: 0xffffff,

			primary,
			underlay,

			edgeAtlasRect: edgeRegion
				? [edgeRegion.u0, edgeRegion.v0, edgeRegion.u1, edgeRegion.v1]
				: null,

			edgeMode,

			animationSpeed: animation?.speed ?? 0,
			windInfluence: animation?.windInfluence ?? 0,
		};
	}

	resolveWorld(material: VisualMaterialRef): ResolvedStaticWorldGpuMaterial {
		if (material.kind === "tile") {
			throw new Error(
				"GpuMaterialLibrary.resolveWorld: tile material belongs to the ground renderer",
			);
		}

		if (material.kind === "terrain") {
			const batchKey = materialBatchKey(
				`terrain:fallback:${material.fallbackColor}`,
			);

			const cached = this.worldCache.get(batchKey);

			if (cached) {
				return cached;
			}

			const resolved: ResolvedStaticWorldGpuMaterial = {
				batchKey,
				texture: Texture.WHITE,
				usesTexture: false,
				fallbackColor: material.fallbackColor,
				alpha: 1,
			};

			this.worldCache.set(batchKey, resolved);

			return resolved;
		}

		const family = resolveBarrierMaterial(material.barrier);

		const texture =
			material.surface === "segment-face"
				? family.segmentFaceTexture
				: material.surface === "segment-top"
					? family.segmentTopTexture
					: material.surface === "connector-face"
						? (family.connectorFaceTexture ?? family.segmentFaceTexture)
						: (family.connectorTopTexture ??
							family.segmentTopTexture ??
							family.connectorFaceTexture);

		const usesTexture = texture !== undefined;

		const batchKey = materialBatchKey(
			[
				"barrier",
				material.barrier,
				material.surface,
				usesTexture ? "texture" : `fallback:${material.fallbackColor}`,
				`alpha:${material.alpha}`,
			].join(":"),
		);

		const cached = this.worldCache.get(batchKey);

		if (cached) {
			return cached;
		}

		const resolved: ResolvedStaticWorldGpuMaterial = {
			batchKey,
			texture: texture ?? Texture.WHITE,
			usesTexture,
			fallbackColor: material.fallbackColor,
			alpha: material.alpha,
		};

		this.worldCache.set(batchKey, resolved);

		return resolved;
	}
}
