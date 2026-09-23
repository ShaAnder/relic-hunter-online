import { Assets, type Texture } from "pixi.js";
import {
	EdgeMapTileCode,
	type CompiledEdgeMap,
	type GridCoord,
} from "@relic-hunter/shared";
import { ROAD_TEXTURE_URLS } from "./roadMaterial";
import { PAVEMENT_TEXTURE_URLS } from "./pavementMaterial";
import { FLOOR_TEXTURE_URLS } from "./floorMaterial";
import { GRASS_TEXTURE_URLS } from "./grassMaterial";
import { WATER_TEXTURE_URLS } from "./waterMaterial";

interface TileTextureFamily {
	urls: readonly string[];
}

export interface ResolvedTileOverlay {
	texture: Texture;
	alpha: number;
}

export interface ResolvedTileMaterial {
	baseTexture?: Texture;
	overlays: readonly ResolvedTileOverlay[];
}

export interface TileMaterialResolveContext {
	code: EdgeMapTileCode | undefined;
	coord: GridCoord;
	compiled: CompiledEdgeMap;
	mapSeed: number;
	floorIndex: number;
}

const TILE_TEXTURE_FAMILIES: Partial<
	Record<EdgeMapTileCode, TileTextureFamily>
> = {
	[EdgeMapTileCode.Road]: {
		urls: ROAD_TEXTURE_URLS,
	},

	[EdgeMapTileCode.Pavement]: {
		urls: PAVEMENT_TEXTURE_URLS,
	},

	[EdgeMapTileCode.Floor]: {
		urls: FLOOR_TEXTURE_URLS,
	},

	[EdgeMapTileCode.Nature]: {
		urls: GRASS_TEXTURE_URLS,
	},

	[EdgeMapTileCode.River]: {
		urls: WATER_TEXTURE_URLS,
	},
};

const textureCache = new Map<string, Texture>();
let preLoadPromise: Promise<void> | null = null;

export function preloadMapMaterials(): Promise<void> {
	preLoadPromise ??= (async () => {
		const urls = [
			...new Set(
				Object.values(TILE_TEXTURE_FAMILIES).flatMap(
					(family) => family?.urls ?? [],
				),
			),
		];

		await Promise.all(
			urls.map(async (url) => {
				const texture = await Assets.load<Texture>(url);
				textureCache.set(url, texture);
			}),
		);
	})();
	return preLoadPromise;
}

export function resolveTileMaterial(
	context: TileMaterialResolveContext,
): ResolvedTileMaterial {
	const { code, coord, mapSeed, floorIndex } = context;
	if (code === undefined) {
		return {
			baseTexture: undefined,
			overlays: [],
		};
	}
	const family = TILE_TEXTURE_FAMILIES[code];
	if (!family || family.urls.length === 0) {
		return {
			baseTexture: undefined,
			overlays: [],
		};
	}
	const hash = hashTile(mapSeed, floorIndex, coord.x, coord.y, code);
	const url = family.urls[hash % family.urls.length];
	return {
		baseTexture: textureCache.get(url),
		// Reserved for future:
		// cracks, dust, markings, etc.
		overlays: [],
	};
}

function hashTile(
	mapSeed: number,
	floorIndex: number,
	x: number,
	y: number,
	code: number,
): number {
	let h = mapSeed | 0;
	h ^= Math.imul(floorIndex + 1, 0x9e3779b1);
	h ^= Math.imul(x + 1, 0x85ebca6b);
	h ^= Math.imul(y + 1, 0xc2b2ae35);
	h ^= Math.imul(code + 1, 0x27d4eb2f);
	h ^= h >>> 16;
	h = Math.imul(h, 0x7feb352d);
	h ^= h >>> 15;
	h = Math.imul(h, 0x846ca68b);
	h ^= h >>> 16;
	return h >>> 0;
}
