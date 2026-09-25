import { Texture } from "pixi.js";
import type { Texture as PixiTexture } from "pixi.js";
import type { VisualMaterialRef } from "../materials/MaterialKey";
import { resolveTileVariant } from "../materials/mapMaterialFactory";
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
	private readonly groundCache = new Map<
		MaterialBatchKey,
		ResolvedGroundGpuMaterial
	>();
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

		const variant = resolveTileVariant(material.code, material.variantHash);
		const usesTexture = variant.texture !== undefined;
		const batchKey = materialBatchKey(
			usesTexture
				? `tile:${material.code ?? "none"}:variant:${variant.variantIndex}:normal:ground`
				: `tile:${material.code ?? "none"}:fallback:${material.fallbackColor}:normal:ground`,
		);
		const cached = this.groundCache.get(batchKey);

		if (cached) {
			return cached;
		}

		const resolved: ResolvedGroundGpuMaterial = {
			batchKey,
			texture: variant.texture ?? Texture.WHITE,
			usesTexture,
			fallbackColor: material.fallbackColor,
		};

		this.groundCache.set(batchKey, resolved);

		return resolved;
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
