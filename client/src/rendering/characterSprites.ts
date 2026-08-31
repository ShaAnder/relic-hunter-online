import { Assets, Rectangle, Texture } from "pixi.js";
import type {
	CharacterAnimation,
	CharacterDirection,
	IsoFacing,
	SpriteCharacterClass,
} from "@/types/characterSprite";
import {
	DEFAULT_ANIMATION_SPECS,
	SPRITE_FRAME_HEIGHT,
	SPRITE_FRAME_WIDTH,
	toIsoFacing,
} from "@/types/characterSprite";
import { resolveSheetDirection } from "@/math/characterDirection";
import { getSpriteManifest } from "@/sprites/manifests/brawler";

/**
 * Full-sheet atlas loader driven by packer output:
 *   assets/characters/{class}/sheet.png
 *   assets/characters/{class}/atlas.json   (row map from pack-character-sheet.mjs)
 *
 * Falls back to built-in BRAWLER_ROW_MAP if atlas.json is missing.
 */

interface PackedAtlas {
	frameWidth: number;
	frameHeight: number;
	columns: number;
	/** "walk/se" | "idle" → row index */
	rows: Record<string, number>;
}

interface ClassSheetAtlas extends PackedAtlas {
	url: string;
}

const sheetModules = import.meta.glob("../assets/characters/*/sheet.png", {
	eager: true,
	import: "default",
}) as Record<string, string>;

const atlasModules = import.meta.glob("../assets/characters/*/atlas.json", {
	eager: true,
	import: "default",
}) as Record<string, PackedAtlas>;

function classFromSheetPath(path: string): string | null {
	const parts = path.replace(/\\/g, "/").split("/");
	const file = parts[parts.length - 1] ?? "";
	if (file.toLowerCase() !== "sheet.png") return null;
	return (parts[parts.length - 2] ?? "").toLowerCase() || null;
}

function classFromAtlasPath(path: string): string | null {
	const parts = path.replace(/\\/g, "/").split("/");
	const file = parts[parts.length - 1] ?? "";
	if (file.toLowerCase() !== "atlas.json") return null;
	return (parts[parts.length - 2] ?? "").toLowerCase() || null;
}

/** Temporary hardcoded rows until packer atlas.json exists. */
const FALLBACK_BRAWLER_ROWS: Record<string, number> = {
	"idle": 0,
	"idle/se": 0,
	"walk": 1,
	"walk/se": 1,
	"run": 1,
	"run/se": 1,
	"attack": 2,
	"attack/se": 2,
	"walk/sw": 3,
	"attack/sw": 4,
	"walk/ne": 5,
	"walk/nw": 6,
	"attack/nw": 7,
	"attack/ne": 2,
	"idle/sw": 0,
	"idle/ne": 0,
	"idle/nw": 0,
};

const ATLAS_BY_CLASS = new Map<string, ClassSheetAtlas>();

// JSON atlases
const jsonByClass = new Map<string, PackedAtlas>();
for (const [path, data] of Object.entries(atlasModules)) {
	const cls = classFromAtlasPath(path);
	if (cls && data) jsonByClass.set(cls, data as PackedAtlas);
}

for (const [path, url] of Object.entries(sheetModules)) {
	const cls = classFromSheetPath(path);
	if (!cls) continue;

	const packed = jsonByClass.get(cls);
	ATLAS_BY_CLASS.set(cls, {
		url,
		frameWidth: packed?.frameWidth ?? SPRITE_FRAME_WIDTH,
		frameHeight: packed?.frameHeight ?? SPRITE_FRAME_HEIGHT,
		columns: packed?.columns ?? 12,
		rows:
			packed?.rows ??
			(cls === "brawler" ? FALLBACK_BRAWLER_ROWS : { idle: 0, walk: 1 }),
	});
}

export interface LoadedAnimationStrip {
	frames: Texture[];
	fps: number;
	loop: boolean;
	flipX: boolean;
	/** Per-frame ms; if set, used instead of constant fps. */
	durations?: number[];
}

const stripCache = new Map<string, LoadedAnimationStrip>();
const baseTextureCache = new Map<string, Texture>();

function applyNearest(texture: Texture): void {
	const source = texture.source;
	if (source && source.scaleMode !== "nearest") {
		source.scaleMode = "nearest";
	}
}

async function getBaseTexture(atlas: ClassSheetAtlas): Promise<Texture> {
	const cached = baseTextureCache.get(atlas.url);
	if (cached) return cached;
	const base = (await Assets.load(atlas.url)) as Texture;
	applyNearest(base);
	baseTextureCache.set(atlas.url, base);
	return base;
}

function sliceRow(
	base: Texture,
	row: number,
	columns: number,
	frameWidth: number,
	frameHeight: number,
	frameCount: number,
): Texture[] {
	const frames: Texture[] = [];
	const count = Math.min(frameCount, columns);
	const y = row * frameHeight;
	if (y + frameHeight > base.height + 0.5) return frames;
	for (let col = 0; col < count; col++) {
		const x = col * frameWidth;
		if (x + frameWidth > base.width + 0.5) break;
		frames.push(
			new Texture({
				source: base.source,
				frame: new Rectangle(x, y, frameWidth, frameHeight),
			}),
		);
	}
	return frames;
}

function resolveRow(
	atlas: ClassSheetAtlas,
	animation: CharacterAnimation,
	facing: IsoFacing,
): number | null {
	const directed = atlas.rows[`${animation}/${facing}`];
	if (directed !== undefined) return directed;

	const plain = atlas.rows[animation];
	if (plain !== undefined) return plain;

	if (animation === "run") {
		const w = atlas.rows[`walk/${facing}`] ?? atlas.rows["walk"];
		if (w !== undefined) return w;
	}

	if (animation === "idle") {
		const se = atlas.rows["idle/se"] ?? atlas.rows["idle"];
		if (se !== undefined) return se;
	}

	return null;
}

function resolveTiming(
	characterClass: SpriteCharacterClass,
	animation: CharacterAnimation,
): { frameCount: number; fps: number; loop: boolean; durations?: number[] } {
	const manifest = getSpriteManifest(characterClass);
	const anim = manifest.animations[animation];
	const fallback = DEFAULT_ANIMATION_SPECS[animation];
	if (!anim) {
		return {
			frameCount: fallback.frameCount,
			fps: fallback.fps,
			loop: fallback.loop,
			durations: fallback.durations,
		};
	}
	return {
		frameCount: anim.frames,
		fps: anim.fps ?? fallback.fps,
		loop: anim.loop,
		durations: anim.durations,
	};
}

export async function loadCharacterAnimation(
	characterClass: SpriteCharacterClass,
	animation: CharacterAnimation,
	direction: CharacterDirection | IsoFacing = "se",
): Promise<LoadedAnimationStrip | null> {
	const facing = toIsoFacing(direction);
	const cacheKey = `${characterClass}/${animation}/${facing}`;
	const cached = stripCache.get(cacheKey);
	if (cached) return cached;

	const atlas = ATLAS_BY_CLASS.get(characterClass);
	if (!atlas) return null;

	const { sheetDir, flipX } = resolveSheetDirection(facing);
	const row = resolveRow(atlas, animation, sheetDir);
	if (row === null) return null;

	const timing = resolveTiming(characterClass, animation);
	const base = await getBaseTexture(atlas);
	const frameWidth = atlas.frameWidth;
	const frameHeight = atlas.frameHeight;

	const frames = sliceRow(
		base,
		row,
		atlas.columns,
		frameWidth,
		frameHeight,
		timing.frameCount,
	);
	if (frames.length === 0) return null;

	const strip: LoadedAnimationStrip = {
		frames,
		fps: timing.fps,
		loop: timing.loop,
		flipX,
		durations: timing.durations,
	};
	stripCache.set(cacheKey, strip);
	return strip;
}

export async function preloadCharacterClass(
	characterClass: SpriteCharacterClass,
): Promise<void> {
	await Promise.all([
		loadCharacterAnimation(characterClass, "idle", "se"),
		loadCharacterAnimation(characterClass, "walk", "se"),
	]);
}

export function hasCharacterSheet(
	characterClass: SpriteCharacterClass,
	animation: CharacterAnimation = "idle",
	direction: CharacterDirection | IsoFacing = "se",
): boolean {
	const atlas = ATLAS_BY_CLASS.get(characterClass);
	if (!atlas) return false;
	return resolveRow(atlas, animation, toIsoFacing(direction)) !== null;
}
