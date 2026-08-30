import { Assets, Rectangle, Texture } from "pixi.js";
import type {
	CharacterAnimation,
	SpriteCharacterClass,
} from "@/types/characterSprite";
import {
	DEFAULT_ANIMATION_SPECS,
	SPRITE_FRAME_HEIGHT,
	SPRITE_FRAME_WIDTH,
} from "@/types/characterSprite";

/**
 * Auto-discover character sheet PNGs under assets/characters/{class}/{anim}.png
 * Same pattern as portraits.ts — drop files in, no manual import list.
 */
const sheetModules = import.meta.glob("../assets/characters/*/*.png", {
	eager: true,
	import: "default",
}) as Record<string, string>;

type SheetKey = `${SpriteCharacterClass}/${CharacterAnimation}`;

function parseSheetPath(path: string): {
	characterClass: string;
	animation: string;
} | null {
	// .../assets/characters/brawler/idle.png
	const parts = path.replace(/\\/g, "/").split("/");
	const file = parts[parts.length - 1] ?? "";
	const anim = file.replace(/\.png$/i, "").toLowerCase();
	const cls = (parts[parts.length - 2] ?? "").toLowerCase();
	if (!cls || !anim) return null;
	return { characterClass: cls, animation: anim };
}

const URL_BY_KEY = new Map<SheetKey, string>();
for (const [path, url] of Object.entries(sheetModules)) {
	const parsed = parseSheetPath(path);
	if (!parsed) continue;
	URL_BY_KEY.set(
		`${parsed.characterClass}/${parsed.animation}` as SheetKey,
		url,
	);
}

export interface LoadedAnimationStrip {
	frames: Texture[];
	fps: number;
	loop: boolean;
}

const stripCache = new Map<string, LoadedAnimationStrip>();

/**
 * Force nearest-neighbor on the underlying source so non-integer camera
 * zoom (mobile 1.05 → max 4) does not bilinear-smear pixel edges.
 * Apply once per base texture; frame sub-textures share the same source.
 */
function applyNearest(texture: Texture): void {
	const source = texture.source;
	if (source && source.scaleMode !== "nearest") {
		source.scaleMode = "nearest";
	}
}

/**
 * Slice a horizontal strip into fixed 64×96 frames.
 * Sheet width should be frameCount * 64; height 96 (or taller with padding
 * cropped from the top of each cell if you leave margin — we read top-left).
 */
function sliceStrip(base: Texture, frameCount: number): Texture[] {
	applyNearest(base);
	const frames: Texture[] = [];
	for (let i = 0; i < frameCount; i++) {
		const frame = new Texture({
			source: base.source,
			frame: new Rectangle(
				i * SPRITE_FRAME_WIDTH,
				0,
				SPRITE_FRAME_WIDTH,
				SPRITE_FRAME_HEIGHT,
			),
		});
		frames.push(frame);
	}
	return frames;
}

/**
 * Load (or return cached) animation strip for a class.
 * Missing assets return null — caller keeps placeholder sphere.
 */
export async function loadCharacterAnimation(
	characterClass: SpriteCharacterClass,
	animation: CharacterAnimation,
): Promise<LoadedAnimationStrip | null> {
	const cacheKey = `${characterClass}/${animation}`;
	const cached = stripCache.get(cacheKey);
	if (cached) return cached;

	const url = URL_BY_KEY.get(cacheKey as SheetKey);
	if (!url) return null;

	const base = (await Assets.load(url)) as Texture;
	const spec = DEFAULT_ANIMATION_SPECS[animation];
	const frames = sliceStrip(base, spec.frameCount);
	const strip: LoadedAnimationStrip = {
		frames,
		fps: spec.fps,
		loop: spec.loop,
	};
	stripCache.set(cacheKey, strip);
	return strip;
}

/** Preload the map-critical set for a class (idle + walk). */
export async function preloadCharacterClass(
	characterClass: SpriteCharacterClass,
): Promise<void> {
	await Promise.all([
		loadCharacterAnimation(characterClass, "idle"),
		loadCharacterAnimation(characterClass, "walk"),
	]);
}

export function hasCharacterSheet(
	characterClass: SpriteCharacterClass,
	animation: CharacterAnimation,
): boolean {
	return URL_BY_KEY.has(`${characterClass}/${animation}` as SheetKey);
}
