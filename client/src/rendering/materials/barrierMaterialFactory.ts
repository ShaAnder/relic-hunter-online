import { Assets, type Texture } from "pixi.js";
import { EdgeBarrier } from "@relic-hunter/shared";

import {
	WALL_CONNECTOR_TEXTURE_URLS,
	WALL_FACE_TEXTURE_URLS,
	WALL_TOP_TEXTURE_URLS,
} from "./wallBarrierMaterial";
import {
	FENCE_PANEL_TEXTURE_URLS,
	FENCE_POST_TEXTURE_URLS,
} from "./fenceBarrierMaterial";
import {
	GLASS_MULLION_TEXTURE_URLS,
	GLASS_PANEL_TEXTURE_URLS,
} from "./glassBarrierMaterial";
import {
	LOW_WALL_CONNECTOR_TEXTURE_URLS,
	LOW_WALL_FACE_TEXTURE_URLS,
	LOW_WALL_TOP_TEXTURE_URLS,
} from "./lowWallBarrierMaterial";

interface BarrierTextureFamily {
	segmentFaceUrls: readonly string[];
	segmentTopUrls: readonly string[];
	connectorFaceUrls: readonly string[];
	connectorTopUrls: readonly string[];
}

export interface ResolvedBarrierMaterial {
	segmentFaceTexture?: Texture;
	segmentTopTexture?: Texture;
	connectorFaceTexture?: Texture;
	connectorTopTexture?: Texture;
}

const BARRIER_TEXTURE_FAMILIES: Partial<
	Record<EdgeBarrier, BarrierTextureFamily>
> = {
	[EdgeBarrier.FullWall]: {
		segmentFaceUrls: WALL_FACE_TEXTURE_URLS,
		segmentTopUrls: WALL_TOP_TEXTURE_URLS,
		connectorFaceUrls: WALL_CONNECTOR_TEXTURE_URLS,
		connectorTopUrls: WALL_TOP_TEXTURE_URLS,
	},
	[EdgeBarrier.Fence]: {
		segmentFaceUrls: FENCE_PANEL_TEXTURE_URLS,
		segmentTopUrls: [],
		connectorFaceUrls: FENCE_POST_TEXTURE_URLS,
		connectorTopUrls: FENCE_POST_TEXTURE_URLS,
	},
	[EdgeBarrier.Glass]: {
		segmentFaceUrls: GLASS_PANEL_TEXTURE_URLS,
		segmentTopUrls: [],
		connectorFaceUrls: GLASS_MULLION_TEXTURE_URLS,
		connectorTopUrls: GLASS_MULLION_TEXTURE_URLS,
	},
	[EdgeBarrier.LowWall]: {
		segmentFaceUrls: LOW_WALL_FACE_TEXTURE_URLS,
		segmentTopUrls: LOW_WALL_TOP_TEXTURE_URLS,
		connectorFaceUrls: LOW_WALL_CONNECTOR_TEXTURE_URLS,
		connectorTopUrls: LOW_WALL_TOP_TEXTURE_URLS,
	},
};

const textureCache = new Map<string, Texture>();
let preloadPromise: Promise<void> | null = null;

export function preloadBarrierMaterials(): Promise<void> {
	preloadPromise ??= (async () => {
		const urls = [
			...new Set(
				Object.values(BARRIER_TEXTURE_FAMILIES).flatMap((family) => {
					if (!family) return [];

					return [
						...family.segmentFaceUrls,
						...family.segmentTopUrls,
						...family.connectorFaceUrls,
						...family.connectorTopUrls,
					];
				}),
			),
		];

		await Promise.all(
			urls.map(async (url) => {
				const texture = await Assets.load<Texture>(url);

				/**
				 * Generic barrier surfaces can deliberately use UVs outside
				 * 0..1. Repeat sampling lets one material flow across long or
				 * multi-storey geometry instead of stretching once.
				 */
				texture.source.wrapMode = "repeat";

				textureCache.set(url, texture);
			}),
		);
	})();

	return preloadPromise;
}

export function resolveBarrierMaterial(
	barrier: EdgeBarrier,
): ResolvedBarrierMaterial {
	const family = BARRIER_TEXTURE_FAMILIES[barrier];
	if (!family) return {};

	return {
		segmentFaceTexture: firstLoadedTexture(family.segmentFaceUrls),
		segmentTopTexture: firstLoadedTexture(family.segmentTopUrls),
		connectorFaceTexture: firstLoadedTexture(family.connectorFaceUrls),
		connectorTopTexture: firstLoadedTexture(family.connectorTopUrls),
	};
}

function firstLoadedTexture(urls: readonly string[]): Texture | undefined {
	for (const url of urls) {
		const texture = textureCache.get(url);
		if (texture) return texture;
	}

	return undefined;
}
