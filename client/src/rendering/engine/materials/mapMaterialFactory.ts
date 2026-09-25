import { Assets, CanvasSource, Texture } from "pixi.js";
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

export interface ResolvedTileVariant {
	texture: Texture | undefined;
	variantIndex: number;
}

export interface TileMaterialResolveContext {
	code: EdgeMapTileCode | undefined;
	coord: GridCoord;
	compiled: CompiledEdgeMap;
	mapSeed: number;
	floorIndex: number;
}

/**
 * UV rectangle occupied by one tile image inside the shared ground atlas.
 *
 * Ground can preserve exact painter order inside one mesh because texture
 * choice is encoded in UVs instead of forcing a separate Mesh per texture.
 */
export interface GroundAtlasRegion {
	texture: Texture;
	variantIndex: number;
	u0: number;
	v0: number;
	u1: number;
	v1: number;
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

/**
 * Fallback materials are rare, but keeping them in the same atlas lets the
 * complete ground floor remain one ordered GPU mesh.
 */
const FALLBACK_REGION_RESERVE = 32;
const ATLAS_PADDING_PX = 2;

const atlasRegionsByUrl = new Map<string, GroundAtlasRegion>();
const fallbackAtlasRegions = new Map<number, GroundAtlasRegion>();

let groundAtlasTexture: Texture | null = null;
let groundAtlasCanvas: HTMLCanvasElement | null = null;
let groundAtlasContext: CanvasRenderingContext2D | null = null;

let atlasCellWidth = 0;
let atlasCellHeight = 0;
let atlasColumns = 0;
let atlasTextureSlotCount = 0;
let atlasTotalSlotCount = 0;

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

		buildGroundAtlas(urls);
	})();

	return preLoadPromise;
}

/**
 * Legacy/individual-texture lookup retained for MapRenderer parity while the
 * migration flags still exist.
 */
export function resolveTileVariant(
	code: EdgeMapTileCode | undefined,
	variantHash: number,
): ResolvedTileVariant {
	if (code === undefined) {
		return {
			texture: undefined,
			variantIndex: -1,
		};
	}

	const family = TILE_TEXTURE_FAMILIES[code];

	if (!family || family.urls.length === 0) {
		return {
			texture: undefined,
			variantIndex: -1,
		};
	}

	const variantIndex = variantHash % family.urls.length;
	const url = family.urls[variantIndex];

	return {
		texture: textureCache.get(url),
		variantIndex,
	};
}

/**
 * Resolve one compiled tile to a region of the single shared ground atlas.
 *
 * Every returned region references the same TextureSource. Texture variation
 * therefore changes UVs rather than draw-call identity.
 */
export function resolveGroundAtlasRegion(
	code: EdgeMapTileCode | undefined,
	variantHash: number,
	fallbackColor: number,
): GroundAtlasRegion {
	if (!groundAtlasTexture) {
		throw new Error(
			"resolveGroundAtlasRegion called before preloadMapMaterials completed",
		);
	}

	if (code !== undefined) {
		const family = TILE_TEXTURE_FAMILIES[code];

		if (family && family.urls.length > 0) {
			const variantIndex = variantHash % family.urls.length;
			const url = family.urls[variantIndex];
			const region = atlasRegionsByUrl.get(url);

			if (region) {
				return region;
			}
		}
	}

	return fallbackAtlasRegion(fallbackColor);
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

	const hash = hashTile(mapSeed, floorIndex, coord.x, coord.y, code);
	const variant = resolveTileVariant(code, hash);

	return {
		baseTexture: variant.texture,
		// Reserved for future:
		// cracks, dust, markings, etc.
		overlays: [],
	};
}

/**
 * Build one immutable atlas from all currently loaded ground textures.
 *
 * This is intentionally done during the existing material preload rather than
 * during gameplay, so normal floor rendering performs only cheap UV lookups.
 */
function buildGroundAtlas(urls: readonly string[]): void {
	if (groundAtlasTexture) {
		return;
	}

	const textures = urls
		.map((url) => textureCache.get(url))
		.filter((texture): texture is Texture => texture !== undefined);

	let maxTextureWidth = 4;
	let maxTextureHeight = 4;

	for (const texture of textures) {
		maxTextureWidth = Math.max(
			maxTextureWidth,
			Math.round(texture.source.pixelWidth),
		);

		maxTextureHeight = Math.max(
			maxTextureHeight,
			Math.round(texture.source.pixelHeight),
		);
	}

	atlasCellWidth = maxTextureWidth + ATLAS_PADDING_PX * 2;
	atlasCellHeight = maxTextureHeight + ATLAS_PADDING_PX * 2;

	atlasTextureSlotCount = urls.length;
	atlasTotalSlotCount = atlasTextureSlotCount + FALLBACK_REGION_RESERVE;

	/**
	 * A near-square slot layout keeps the atlas compact without introducing a
	 * general-purpose packing algorithm into Phase 3.
	 */
	atlasColumns = Math.max(1, Math.ceil(Math.sqrt(atlasTotalSlotCount)));
	const rows = Math.max(1, Math.ceil(atlasTotalSlotCount / atlasColumns));

	const canvas = document.createElement("canvas");
	canvas.width = atlasColumns * atlasCellWidth;
	canvas.height = rows * atlasCellHeight;

	const context = canvas.getContext("2d", {
		alpha: true,
	});

	if (!context) {
		throw new Error("Unable to create 2D context for ground material atlas");
	}

	context.clearRect(0, 0, canvas.width, canvas.height);
	context.imageSmoothingEnabled = true;

	/**
	 * Create the shared Texture before recording UV regions so every region can
	 * reference the same TextureSource. The canvas can still be painted after
	 * source creation; one update below publishes the finished atlas.
	 */
	const source = new CanvasSource({
		resource: canvas,
	});

	source.label = "ground-material-atlas";
	source.scaleMode = "linear";
	source.autoGenerateMipmaps = false;

	groundAtlasCanvas = canvas;
	groundAtlasContext = context;
	groundAtlasTexture = new Texture({
		source,
	});

	urls.forEach((url, slotIndex) => {
		const texture = textureCache.get(url);

		if (!texture) {
			return;
		}

		const width = Math.max(1, Math.round(texture.source.pixelWidth));
		const height = Math.max(1, Math.round(texture.source.pixelHeight));
		const { x, y } = atlasSlotOrigin(slotIndex);

		/**
		 * Ground textures are standalone PNG assets, so their source resource can
		 * be copied directly into the atlas canvas.
		 */
		context.drawImage(
			texture.source.resource as CanvasImageSource,
			x + ATLAS_PADDING_PX,
			y + ATLAS_PADDING_PX,
			width,
			height,
		);

		atlasRegionsByUrl.set(
			url,
			createAtlasRegion(
				slotIndex,
				width,
				height,
				canvas.width,
				canvas.height,
				slotIndex,
			),
		);
	});

	groundAtlasTexture.source.update();
}

function fallbackAtlasRegion(color: number): GroundAtlasRegion {
	const normalizedColor = color & 0xffffff;
	const existing = fallbackAtlasRegions.get(normalizedColor);

	if (existing) {
		return existing;
	}

	if (!groundAtlasTexture || !groundAtlasCanvas || !groundAtlasContext) {
		throw new Error(
			"fallbackAtlasRegion called before the ground atlas was initialized",
		);
	}

	const fallbackIndex = fallbackAtlasRegions.size;
	const slotIndex = atlasTextureSlotCount + fallbackIndex;

	if (slotIndex >= atlasTotalSlotCount) {
		throw new Error(
			`Ground material atlas exhausted fallback capacity (${FALLBACK_REGION_RESERVE})`,
		);
	}

	const { x, y } = atlasSlotOrigin(slotIndex);
	const innerWidth = atlasCellWidth - ATLAS_PADDING_PX * 2;
	const innerHeight = atlasCellHeight - ATLAS_PADDING_PX * 2;

	groundAtlasContext.fillStyle = `#${normalizedColor
		.toString(16)
		.padStart(6, "0")}`;

	groundAtlasContext.fillRect(
		x + ATLAS_PADDING_PX,
		y + ATLAS_PADDING_PX,
		innerWidth,
		innerHeight,
	);

	const region = createAtlasRegion(
		slotIndex,
		innerWidth,
		innerHeight,
		groundAtlasCanvas.width,
		groundAtlasCanvas.height,
		-1,
	);

	fallbackAtlasRegions.set(normalizedColor, region);

	/**
	 * Fallback colours are allocated lazily. Tell Pixi that the canvas source
	 * changed so the next draw sees the newly painted slot.
	 */
	groundAtlasTexture.source.update();

	return region;
}

function createAtlasRegion(
	slotIndex: number,
	width: number,
	height: number,
	atlasWidth: number,
	atlasHeight: number,
	variantIndex: number,
): GroundAtlasRegion {
	if (!groundAtlasTexture) {
		throw new Error("Ground atlas texture is not initialized");
	}

	const { x, y } = atlasSlotOrigin(slotIndex);
	const innerX = x + ATLAS_PADDING_PX;
	const innerY = y + ATLAS_PADDING_PX;

	/**
	 * A half-pixel inset keeps linear filtering inside the selected image instead
	 * of sampling a neighbouring atlas slot at exact UV boundaries.
	 */
	const insetX = width > 1 ? 0.5 : 0;
	const insetY = height > 1 ? 0.5 : 0;

	return {
		texture: groundAtlasTexture,
		variantIndex,
		u0: (innerX + insetX) / atlasWidth,
		v0: (innerY + insetY) / atlasHeight,
		u1: (innerX + width - insetX) / atlasWidth,
		v1: (innerY + height - insetY) / atlasHeight,
	};
}

function atlasSlotOrigin(slotIndex: number): {
	x: number;
	y: number;
} {
	return {
		x: (slotIndex % atlasColumns) * atlasCellWidth,
		y: Math.floor(slotIndex / atlasColumns) * atlasCellHeight,
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
