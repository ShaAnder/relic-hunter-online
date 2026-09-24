import { Texture } from "pixi.js";
import type { Texture as PixiTexture } from "pixi.js";
import type { VisualMaterialRef } from "../materials/MaterialKey";
import { resolveTileVariant } from "../materials/mapMaterialFactory";
import {
	materialBatchKey,
	type MaterialBatchKey,
} from "../batching/MaterialBatchKey";

export interface ResolvedGroundGpuMaterial {
	batchKey: MaterialBatchKey;
	texture: PixiTexture;
	usesTexture: boolean;
	fallbackColor: number;
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
}
