/**
 * Character sprite types — strip-source + packed atlas pipeline.
 */

/** Four isometric facings matching diamond grid movement. */
export type IsoFacing = "ne" | "se" | "sw" | "nw";

/** @deprecated Prefer IsoFacing; kept for gradual migration. */
export type CharacterDirection =
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w"
	| "nw";

export type CharacterAnimation =
	| "idle"
	| "walk"
	| "run"
	| "attack"
	| "critical"
	| "hit"
	| "stunned"
	| "defeated"
	| "victory";

export const SPRITE_FRAME_WIDTH = 128;
export const SPRITE_FRAME_HEIGHT = 128;
export const MAP_SPRITE_SCALE = 0.5;

export interface AnimationSheetSpec {
	frameCount: number;
	fps: number;
	loop: boolean;
	frameWidth?: number;
	frameHeight?: number;
	/** Optional per-frame duration in ms (overrides constant fps). */
	durations?: number[];
}

/**
 * Fallback specs when a character has no manifest entry.
 * Prefer getSpriteManifest(class).animations[anim] at runtime.
 */
export const DEFAULT_ANIMATION_SPECS: Record<
	CharacterAnimation,
	AnimationSheetSpec
> = {
	idle: {
		frameCount: 1,
		fps: 1,
		loop: true,
		frameWidth: 128,
		frameHeight: 128,
	},
	walk: {
		frameCount: 6,
		fps: 9,
		loop: true,
		frameWidth: 128,
		frameHeight: 128,
	},
	run: {
		frameCount: 4,
		fps: 12,
		loop: true,
		frameWidth: 128,
		frameHeight: 128,
	},
	attack: {
		frameCount: 5,
		fps: 12,
		loop: false,
		frameWidth: 128,
		frameHeight: 128,
		durations: [100, 90, 45, 70, 120],
	},
	critical: {
		frameCount: 5,
		fps: 12,
		loop: false,
		frameWidth: 128,
		frameHeight: 128,
	},
	hit: {
		frameCount: 3,
		fps: 10,
		loop: false,
		frameWidth: 128,
		frameHeight: 128,
		durations: [60, 100, 120],
	},
	stunned: {
		frameCount: 2,
		fps: 4,
		loop: true,
		frameWidth: 128,
		frameHeight: 128,
	},
	defeated: {
		frameCount: 5,
		fps: 8,
		loop: false,
		frameWidth: 128,
		frameHeight: 128,
	},
	victory: {
		frameCount: 4,
		fps: 8,
		loop: false,
		frameWidth: 128,
		frameHeight: 128,
	},
};

export type SpriteCharacterClass =
	| "brawler"
	| "hunter"
	| "scout"
	| "tank"
	| "mage"
	| "summoner"
	| "trapper";

export function toSpriteCharacterClass(
	characterClass: string | null | undefined,
): SpriteCharacterClass {
	switch (characterClass) {
		case "brawler":
		case "hunter":
		case "scout":
		case "tank":
		case "mage":
		case "summoner":
		case "trapper":
			return characterClass;
		default:
			return "brawler";
	}
}

/** Narrow 8-way / string to IsoFacing. */
export function toIsoFacing(
	dir: CharacterDirection | IsoFacing | string,
): IsoFacing {
	switch (dir) {
		case "ne":
		case "nw":
		case "se":
		case "sw":
			return dir;
		case "e":
		case "s":
			return "se";
		case "w":
			return "sw";
		case "n":
			return "ne";
		default:
			return "se";
	}
}
