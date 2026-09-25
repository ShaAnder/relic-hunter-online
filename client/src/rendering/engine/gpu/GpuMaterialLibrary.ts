import { Texture } from "pixi.js";
import type { Texture as PixiTexture } from "pixi.js";
import type { VisualMaterialRef } from "../materials/MaterialKey";
import {
	resolveGroundAtlasRegion,
	type GroundAtlasRegion,
} from "../materials/mapMaterialFactory";
import {
	materialBatchKey,
	type MaterialBatchKey,
} from "../batching/MaterialBatchKey";
import { resolveBarrierMaterial } from "../materials/barrierMaterialFactory";

export interface ResolvedGroundGpuMaterial {
	batchKey: MaterialBatchKey;
	texture: PixiTexture;
	usesTexture: boolean;
	fallbackColor: number;

	/**
	 * Per-tile atlas region.
	 *
	 * All ground materials share one TextureSource; only this UV rectangle
	 * changes from tile to tile.
	 */
	uvRect: Pick<GroundAtlasRegion, "u0" | "v0" | "u1" | "v1">;
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

	resolveGround(material: VisualMaterialRef): ResolvedGroundGpuMaterial {
		if (material.kind !== "tile") {
			throw new Error(
				`GpuMaterialLibrary.resolveGround: expected tile material, received ${material.kind}`,
			);
		}

		const region = resolveGroundAtlasRegion(
			material.code,
			material.variantHash,
			material.fallbackColor,
		);

		return {
			batchKey: this.groundAtlasBatchKey,
			texture: region.texture,
			usesTexture: true,

			/**
			 * Fallback colours are painted into atlas slots too, so the shader
			 * always follows its texture path for the floor-wide ground mesh.
			 */
			fallbackColor: 0xffffff,

			uvRect: {
				u0: region.u0,
				v0: region.v0,
				u1: region.u1,
				v1: region.v1,
			},
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
						? (family.connectorFaceTexture ??
							family.segmentFaceTexture)
						: (family.connectorTopTexture ??
							family.segmentTopTexture ??
							family.connectorFaceTexture);

		const usesTexture = texture !== undefined;

		const batchKey = materialBatchKey(
			[
				"barrier",
				material.barrier,
				material.surface,
				usesTexture
					? "texture"
					: `fallback:${material.fallbackColor}`,
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
