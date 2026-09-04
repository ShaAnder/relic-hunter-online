/**
 * Per-character sprite manifest — source of truth for frame counts / timing.
 * Packer + runtime both align to this (runtime also reads atlas.json rows).
 *
 * Deliberately does NOT declare frameWidth/frameHeight or a
 * footOffsetY here — every character sheet uses the one global
 * SPRITE_FRAME_WIDTH/HEIGHT (see types/characterSprite.ts) and the
 * fixed feet-at-frame-bottom convention, enforced by the packer.
 * There is nothing per-character to tune for either.
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
	/** Use single pose + runtime bob instead of multi-frame idle. */
	runtimeIdle?: boolean;
}

export interface CharacterSpriteManifest {
	characterClass: string;
	/** Map display scale — see MAP_SPRITE_SCALE; override only for a genuinely different silhouette size, not to compensate for wrong-size source art. */
	scale: number;
	/** Integer-pixel idle bob amplitudes (texture px, pre-scale), interpolated smoothly at runtime — not a discrete step sequence. */
	idleBobY: number[];
	idleBobPeriodMs: number;
	animations: Partial<Record<CharacterAnimation, AnimManifest>>;
	/** Preferred authored facings for this character. */
	facings: IsoFacing[];
}

export const brawlerSprite: CharacterSpriteManifest = {
	characterClass: "brawler",
	scale: 0.5,
	idleBobY: [0, -1, -2, -1, 0],
	idleBobPeriodMs: 1400,
	facings: ["se", "sw", "ne", "nw"],
	animations: {
		idle: {
			frames: 4,
			loop: true,
			fps: 4,
		},
		walk: {
			frames: 6,
			loop: true,
			fps: 4.5, // halved from 9 - was reading as a blur, not a clear stride
			// optional uneven contacts:
			// durations: [100, 70, 100, 70, 100, 70],
		},
		run: {
			frames: 4,
			loop: true,
			fps: 12,
		},
		attack: {
			frames: 4,
			loop: false,
			// draw -> aim -> fire -> recover. Note: sw has 4 real frames,
			// ne has 6 — this count matches sw; ne's last 2 frames are
			// unused until the manifest supports a per-direction count.
			durations: [220, 200, 160, 220],
		},
		defend: {
			frames: 2,
			loop: true,
			fps: 3,
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
