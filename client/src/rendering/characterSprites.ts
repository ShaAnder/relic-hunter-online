import { Assets, Rectangle, Texture } from "pixi.js";
import type {
	CharacterAnimation,
	IsoFacing,
	SpriteCharacterClass,
} from "@/types/characterSprite";
import {
	DEFAULT_ANIMATION_SPECS,
	SPRITE_FRAME_HEIGHT,
	SPRITE_FRAME_WIDTH,
	toIsoFacing,
} from "@/types/characterSprite";
import { mirrorPartner } from "@/math/characterDirection";
import { getSpriteManifest } from "@/sprites/manifests/brawler";

/**
 * Full-sheet atlas loader driven by packer output:
 *   assets/characters/{class}/sheet.png
 *   assets/characters/{class}/atlas.json   (row map from pack-character-sheet.mjs)
 *
 * There is no silent fallback for a missing or malformed atlas — a
 * class with no valid atlas simply has no sprite, and callers (via
 * hasCharacterSheet) fall back to the placeholder token. A wrong-size
 * sprite rendered without warning is worse than no sprite at all.
 */

interface PackedAtlas {
	frameWidth: number;
	frameHeight: number;
	columns: number;
	/** "walk/se" | "idle" → row index */
	rows: Record<string, number>;
	/** Per-row real frame count — a direction can genuinely have fewer (or more) authored frames than another direction of the same animation. */
	strips?: { anim: string; facing: string; row: number; frames: number }[];
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

const ATLAS_BY_CLASS = new Map<string, ClassSheetAtlas>();

const jsonByClass = new Map<string, PackedAtlas>();
for (const [path, data] of Object.entries(atlasModules)) {
	const cls = classFromAtlasPath(path);
	if (cls && data) jsonByClass.set(cls, data as PackedAtlas);
}

for (const [path, url] of Object.entries(sheetModules)) {
	const cls = classFromSheetPath(path);
	if (!cls) continue;

	const packed = jsonByClass.get(cls);
	if (!packed) {
		console.error(
			`[characterSprites] "${cls}" has sheet.png but no atlas.json — skipping. Run pack-character-sheet.mjs.`,
		);
		continue;
	}

	// Hard invariant, not a soft default: a sheet built at any other
	// frame size is rejected outright rather than silently displayed
	// at the wrong scale. This is exactly the failure mode that once
	// produced a sprite a quarter the intended size with no warning.
	if (
		packed.frameWidth !== SPRITE_FRAME_WIDTH ||
		packed.frameHeight !== SPRITE_FRAME_HEIGHT
	) {
		console.error(
			`[characterSprites] "${cls}" atlas.json declares ${packed.frameWidth}×${packed.frameHeight} frames, ` +
				`but the game requires exactly ${SPRITE_FRAME_WIDTH}×${SPRITE_FRAME_HEIGHT}. ` +
				`Re-pack with the correct source art size — skipping this class's sprite entirely rather than rendering it wrong.`,
		);
		continue;
	}

	ATLAS_BY_CLASS.set(cls, {
		url,
		frameWidth: packed.frameWidth,
		frameHeight: packed.frameHeight,
		columns: packed.columns,
		rows: packed.rows,
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
const warnedOnce = new Set<string>();

function warnOnce(key: string, message: string): void {
	if (warnedOnce.has(key)) return;
	warnedOnce.add(key);
	console.warn(`[characterSprites] ${message}`);
}

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

/**
 * Resolves which row to slice and whether to flip it, trying in
 * order: the exact authored direction, that direction's mirror
 * partner (NE↔NW, SE↔SW only — see characterDirection.ts for why
 * there is no N/S partner), run falling back to walk's own
 * resolution, then whichever direction was authored first for this
 * animation at all. Returns null only if the animation doesn't exist
 * in this atlas in any direction.
 */
function resolveRow(
	atlas: ClassSheetAtlas,
	characterClass: string,
	animation: CharacterAnimation,
	facing: IsoFacing,
): { row: number; flipX: boolean } | null {
	const directKey = `${animation}/${facing}`;
	if (atlas.rows[directKey] !== undefined) {
		return { row: atlas.rows[directKey]!, flipX: false };
	}

	const partner = mirrorPartner(facing);
	const partnerKey = `${animation}/${partner}`;
	if (atlas.rows[partnerKey] !== undefined) {
		warnOnce(
			`${characterClass}/${directKey}/mirror`,
			`"${characterClass}" has no "${directKey}" — mirroring "${partnerKey}". Draw this direction for real when possible (a held weapon can flip to the wrong hand when mirrored).`,
		);
		return { row: atlas.rows[partnerKey]!, flipX: true };
	}

	if (animation === "run") {
		const viaWalk = resolveRow(atlas, characterClass, "walk", facing);
		if (viaWalk) {
			warnOnce(
				`${characterClass}/run/${facing}/viaWalk`,
				`"${characterClass}" has no "run/${facing}" — using its walk animation instead.`,
			);
			return viaWalk;
		}
	}

	if (atlas.rows[animation] !== undefined) {
		warnOnce(
			`${characterClass}/${animation}/anyDirection`,
			`"${characterClass}" has no "${animation}" for any direction near "${facing}" — using whichever direction was authored first.`,
		);
		return { row: atlas.rows[animation]!, flipX: false };
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
	direction: IsoFacing | string = "se",
): Promise<LoadedAnimationStrip | null> {
	const facing = toIsoFacing(direction);
	const cacheKey = `${characterClass}/${animation}/${facing}`;
	const cached = stripCache.get(cacheKey);
	if (cached) return cached;

	const atlas = ATLAS_BY_CLASS.get(characterClass);
	if (!atlas) return null;

	const resolved = resolveRow(atlas, characterClass, animation, facing);
	if (!resolved) return null;

	const timing = resolveTiming(characterClass, animation);
	const base = await getBaseTexture(atlas);

	// The manifest's frame count is shared across every direction of an
	// animation, but different directions can genuinely have different
	// real frame counts (e.g. attack/sw has 4, attack/ne has 6). Cap by
	// whichever is smaller so playback never reads past what this
	// specific row actually has — the manifest undershooting on purpose
	// is fine, it overshooting into another row's pixels is not.
	const packedFrameCount = atlas.strips?.find(
		(s) => s.row === resolved.row,
	)?.frames;
	const frameCount =
		packedFrameCount !== undefined
			? Math.min(timing.frameCount, packedFrameCount)
			: timing.frameCount;

	const frames = sliceRow(
		base,
		resolved.row,
		atlas.columns,
		atlas.frameWidth,
		atlas.frameHeight,
		frameCount,
	);
	if (frames.length === 0) {
		warnOnce(
			`${cacheKey}/sliceFailed`,
			`"${characterClass}" row ${resolved.row} for "${animation}/${facing}" sliced zero frames — sheet.png may be smaller than atlas.json claims.`,
		);
		return null;
	}

	const strip: LoadedAnimationStrip = {
		frames,
		fps: timing.fps,
		loop: timing.loop,
		flipX: resolved.flipX,
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
	direction: IsoFacing | string = "se",
): boolean {
	const atlas = ATLAS_BY_CLASS.get(characterClass);
	if (!atlas) return false;
	return (
		resolveRow(atlas, characterClass, animation, toIsoFacing(direction)) !==
		null
	);
}
