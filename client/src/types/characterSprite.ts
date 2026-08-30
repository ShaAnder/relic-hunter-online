/**
 * Character sprite types — full-sheet atlas (128×128 cells).
 */

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

/** Cell size for the current Brawler full sheet. */
export const SPRITE_FRAME_WIDTH = 128;
export const SPRITE_FRAME_HEIGHT = 128;

/** Map display scale — 128px body on 64×32 tiles. */
export const MAP_SPRITE_SCALE = 0.5;

export interface AnimationSheetSpec {
	frameCount: number;
	fps: number;
	loop: boolean;
	frameWidth?: number;
	frameHeight?: number;
}

export const DEFAULT_ANIMATION_SPECS: Record<
	CharacterAnimation,
	AnimationSheetSpec
> = {
	idle: {
		frameCount: 12,
		fps: 8,
		loop: true,
		frameWidth: 128,
		frameHeight: 128,
	},
	walk: {
		frameCount: 12,
		fps: 10,
		loop: true,
		frameWidth: 128,
		frameHeight: 128,
	},
	run: {
		frameCount: 12,
		fps: 12,
		loop: true,
		frameWidth: 128,
		frameHeight: 128,
	},
	attack: {
		frameCount: 12,
		fps: 12,
		loop: false,
		frameWidth: 128,
		frameHeight: 128,
	},
	critical: {
		frameCount: 12,
		fps: 12,
		loop: false,
		frameWidth: 128,
		frameHeight: 128,
	},
	hit: {
		frameCount: 4,
		fps: 10,
		loop: false,
		frameWidth: 128,
		frameHeight: 128,
	},
	stunned: {
		frameCount: 4,
		fps: 6,
		loop: true,
		frameWidth: 128,
		frameHeight: 128,
	},
	defeated: {
		frameCount: 4,
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
