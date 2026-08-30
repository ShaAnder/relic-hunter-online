import { Assets, Rectangle, Texture } from "pixi.js";
import type {
	CharacterAnimation,
	CharacterDirection,
	SpriteCharacterClass,
} from "@/types/characterSprite";
import {
	DEFAULT_ANIMATION_SPECS,
	SPRITE_FRAME_HEIGHT,
	SPRITE_FRAME_WIDTH,
} from "@/types/characterSprite";
import { resolveSheetDirection } from "@/math/characterDirection";

/**
 * Full-sheet atlas loader.
 *
 * Drop ONE file per class:
 *   client/src/assets/characters/brawler/sheet.png
 *
 * Current Brawler sheet: 1536×1024 = 12 columns × 8 rows of 128×128.
 * Rows (top → bottom) match the authored sheet layout.
 *
 * No strip splitting, no chroma key — frames are pure Rectangle crops
 * on the original texture.
 */

/** Per-class atlas description. Add entries as new class sheets land. */
interface ClassSheetAtlas {
	/** Vite URL from import.meta.glob */
	url: string;
	frameWidth: number;
	frameHeight: number;
	columns: number;
	/**
	 * animation → row index, or animation/direction → row index.
	 * Keys are "idle" | "walk" | "attack" | "walk/se" | "walk/sw" | …
	 */
	rows: Record<string, number>;
}

/**
 * Brawler row map — adjust indices if your sheet order differs.
 * Default assumes the 8-row merc sheet:
 *   0 idle SE, 1 walk SE, 2 attack SE,
 *   3 walk SW, 4 attack SW,
 *   5 walk NE, 6 walk N, 7 attack N
 */
const BRAWLER_ROW_MAP: Record<string, number> = {
	"idle": 0,
	"idle/se": 0,
	"walk": 1,
	"walk/se": 1,
	"run": 1, // no dedicated run row — reuse walk
	"run/se": 1,
	"attack": 2,
	"attack/se": 2,
	"walk/sw": 3,
	"attack/sw": 4,
	"walk/ne": 5,
	"walk/n": 6,
	"attack/n": 7,
	// sensible mirrors until more rows exist
	"idle/sw": 0,
	"idle/ne": 0,
	"idle/n": 0,
	"walk/e": 1,
	"walk/w": 3,
	"walk/s": 1,
	"walk/nw": 5,
	"attack/e": 2,
	"attack/w": 4,
	"attack/s": 2,
	"attack/nw": 7,
	"attack/ne": 2,
};

const sheetModules = import.meta.glob("../assets/characters/*/sheet.png", {
	eager: true,
	import: "default",
}) as Record<string, string>;

function classFromPath(path: string): string | null {
	const parts = path.replace(/\\/g, "/").split("/");
	// …/assets/characters/brawler/sheet.png
	const file = parts[parts.length - 1] ?? "";
	if (file.toLowerCase() !== "sheet.png") return null;
	const cls = (parts[parts.length - 2] ?? "").toLowerCase();
	return cls || null;
}

const ATLAS_BY_CLASS = new Map<string, ClassSheetAtlas>();

for (const [path, url] of Object.entries(sheetModules)) {
	const cls = classFromPath(path);
	if (!cls) continue;

	// Only brawler has a known row map today; others can be added later.
	const rows =
		cls === "brawler" ? BRAWLER_ROW_MAP : { idle: 0, walk: 1, attack: 2 };

	ATLAS_BY_CLASS.set(cls, {
		url,
		frameWidth: SPRITE_FRAME_WIDTH,
		frameHeight: SPRITE_FRAME_HEIGHT,
		columns: 12,
		rows,
	});
}

export interface LoadedAnimationStrip {
	frames: Texture[];
	fps: number;
	loop: boolean;
	flipX: boolean;
}

const stripCache = new Map<string, LoadedAnimationStrip>();
/** Base sheet textures, one per class. */
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
	// Guard: row must sit inside the texture
	if (y + frameHeight > base.height + 0.5) {
		return frames;
	}
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

/**
 * Pick a row index for this anim + facing.
 * Tries anim/dir, then anim, then walk←run, then row 0.
 */
function resolveRow(
	atlas: ClassSheetAtlas,
	animation: CharacterAnimation,
	sheetDir: CharacterDirection,
): number | null {
	const directed = atlas.rows[`${animation}/${sheetDir}`];
	if (directed !== undefined) return directed;

	const plain = atlas.rows[animation];
	if (plain !== undefined) return plain;

	if (animation === "walk" || animation === "run") {
		const runDir = atlas.rows[`run/${sheetDir}`] ?? atlas.rows["run"];
		if (runDir !== undefined) return runDir;
		const walkDir = atlas.rows[`walk/${sheetDir}`] ?? atlas.rows["walk"];
		if (walkDir !== undefined) return walkDir;
	}

	if (animation === "idle") {
		const idleSe = atlas.rows["idle/se"] ?? atlas.rows["idle"];
		if (idleSe !== undefined) return idleSe;
	}

	return null;
}

export async function loadCharacterAnimation(
	characterClass: SpriteCharacterClass,
	animation: CharacterAnimation,
	direction: CharacterDirection = "se",
): Promise<LoadedAnimationStrip | null> {
	const cacheKey = `${characterClass}/${animation}/${direction}`;
	const cached = stripCache.get(cacheKey);
	if (cached) return cached;

	const atlas = ATLAS_BY_CLASS.get(characterClass);
	if (!atlas) return null;

	const { sheetDir, flipX } = resolveSheetDirection(direction);
	const row = resolveRow(atlas, animation, sheetDir);
	if (row === null) return null;

	const base = await getBaseTexture(atlas);
	const spec = DEFAULT_ANIMATION_SPECS[animation];
	const frameWidth = spec.frameWidth ?? atlas.frameWidth;
	const frameHeight = spec.frameHeight ?? atlas.frameHeight;

	const frames = sliceRow(
		base,
		row,
		atlas.columns,
		frameWidth,
		frameHeight,
		spec.frameCount,
	);
	if (frames.length === 0) return null;

	const strip: LoadedAnimationStrip = {
		frames,
		fps: spec.fps,
		loop: spec.loop,
		flipX,
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
	direction: CharacterDirection = "se",
): boolean {
	const atlas = ATLAS_BY_CLASS.get(characterClass);
	if (!atlas) return false;
	const { sheetDir } = resolveSheetDirection(direction);
	return resolveRow(atlas, animation, sheetDir) !== null;
}
