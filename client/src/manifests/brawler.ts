/**
 * Per-character sprite manifest — source of truth for frame counts / timing.
 * Packer + runtime both align to this (runtime also reads atlas.json rows).
 *
 * Deliberately does NOT declare frameWidth/frameHeight or a
 * footOffsetY here — every character sheet uses the one global
 * SPRITE_FRAME_WIDTH/HEIGHT (see types/characterSprite.ts) and the
 * fixed feet-at-frame-bottom convention, enforced by the packer.
 * There is nothing per-character to tune for either.
 *
 * Idle is authored multi-frame strips (no runtime bob). NW/SW come from
 * mirroring NE/SE in characterSprites.resolveRow when those rows are absent.
 */
import type { CharacterAnimation, IsoFacing } from "@/types/characterSprite";

export interface AnimManifest {
	/** Authored frames in the strip (packer / atlas). */
	frames: number;
	loop: boolean;
	/** Constant fps when durations omitted. */
	fps?: number;
	/** Per-frame ms — length should match frames when set. */
	durations?: number[];
}

export interface CharacterSpriteManifest {
	characterClass: string;
	/** Map display scale — see MAP_SPRITE_SCALE; override only for a genuinely different silhouette size, not to compensate for wrong-size source art. */
	scale: number;
	animations: Partial<Record<CharacterAnimation, AnimManifest>>;
	/** Preferred authored facings for this character. */
	facings: IsoFacing[];
}

export const brawlerSprite: CharacterSpriteManifest = {
	characterClass: "brawler",
	scale: 0.5,
	facings: ["se", "sw", "ne", "nw"],
	animations: {
		// 4-frame authored idle per facing (idle_se.png / idle_ne.png = 512×128)
		idle: {
			frames: 4,
			loop: true,
			fps: 4,
		},
		walk: {
			frames: 6,
			loop: true,
			fps: 9,
		},
		run: {
			frames: 4,
			loop: true,
			fps: 12,
		},
		attack: {
			frames: 5,
			loop: false,
			durations: [100, 90, 45, 70, 120],
		},
		hit: {
			frames: 3,
			loop: false,
			durations: [60, 100, 120],
		},
		stunned: {
			frames: 2,
			loop: true,
			fps: 4,
		},
		defeated: {
			frames: 5,
			loop: false,
			fps: 8,
		},
		victory: {
			frames: 4,
			loop: false,
			fps: 8,
		},
	},
};

export const SPRITE_MANIFESTS: Record<string, CharacterSpriteManifest> = {
	brawler: brawlerSprite,
};

export function getSpriteManifest(
	characterClass: string,
): CharacterSpriteManifest {
	return SPRITE_MANIFESTS[characterClass] ?? brawlerSprite;
}
