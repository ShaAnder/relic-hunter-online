/**
 * Per-character sprite manifest — source of truth for frame counts / timing.
 * Packer + runtime both align to this (runtime also reads atlas.json rows).
 */
import type { CharacterAnimation } from "@/types/characterSprite";
import type { IsoFacing } from "@/types/characterSprite";

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
	frameWidth: number;
	frameHeight: number;
	/** Map display scale (128 cell → ~64 on map). */
	scale: number;
	/** Foot pad inside cell (texture px); applied as sprite.y after anchor. */
	footOffsetY: number;
	/** Integer-pixel idle bob amplitudes (texture px, pre-scale). */
	idleBobY: number[];
	idleBobPeriodMs: number;
	animations: Partial<Record<CharacterAnimation, AnimManifest>>;
	/** Preferred authored facings for this character. */
	facings: IsoFacing[];
}

export const brawlerSprite: CharacterSpriteManifest = {
	characterClass: "brawler",
	frameWidth: 128,
	frameHeight: 128,
	scale: 0.5,
	// Negative = shift sprite up so boots sit on tile centre — tune in-game
	footOffsetY: -16,
	idleBobY: [0, -1, -2, -1, 0],
	idleBobPeriodMs: 1400,
	facings: ["se", "sw", "ne", "nw"],
	animations: {
		idle: {
			frames: 1,
			loop: true,
			runtimeIdle: true,
			fps: 1,
		},
		walk: {
			frames: 6,
			loop: true,
			fps: 9,
			// optional uneven contacts:
			// durations: [100, 70, 100, 70, 100, 70],
		},
		run: {
			frames: 4,
			loop: true,
			fps: 12,
		},
		attack: {
			frames: 5,
			loop: false,
			// ready → anticipation → STRIKE → follow → recover
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
