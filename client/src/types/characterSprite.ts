import type { CharacterClass } from "@relic-hunter/shared";

/**
 * The one, enforced native frame size for every character sheet in
 * the game. Not a fallback, not a suggestion — the packer refuses to
 * pack anything else, and the loader refuses to trust an atlas.json
 * that claims otherwise. Getting this wrong once (a 32px-source atlas
 * silently accepted against a 128px assumption) produced a sprite a
 * quarter the intended size with zero warning; these are now hard
 * invariants, not soft defaults.
 */
export const SPRITE_FRAME_WIDTH = 128;
export const SPRITE_FRAME_HEIGHT = 128;

/**
 * Map display scale — one global constant, not a per-character tuned
 * value. At 128px native × 0.5 this displays at 64px, matching
 * TILE_WIDTH. If the native frame size above ever changes, this is
 * the only other number that needs reconsidering.
 */
export const MAP_SPRITE_SCALE = 0.5;

/**
 * Mandatory convention every source strip must follow: the
 * character's feet sit at the exact bottom pixel row of the frame,
 * no padding beneath them. This replaces the old per-character
 * footOffsetY magic number entirely — there is nothing to tune,
 * because there is nothing to guess. The packer validates this via
 * alpha-channel inspection at pack time and refuses to produce an
 * atlas for a strip that doesn't comply.
 */
export const FEET_AT_FRAME_BOTTOM = true as const;

/** Four isometric facings — the only directions this diamond grid can ever actually move in. */
export type IsoFacing = "ne" | "se" | "sw" | "nw";

export type CharacterAnimation =
	| "idle"
	| "walk"
	| "run"
	| "attack"
	| "defend"
	| "critical"
	| "hit"
	| "stunned"
	| "defeated"
	| "victory";

export interface AnimationSheetSpec {
	frameCount: number;
	fps: number;
	loop: boolean;
	/** Optional per-frame duration in ms (overrides constant fps). */
	durations?: number[];
}

/**
 * Used only when a character class has no manifest entry at all, or
 * a specific animation is missing from an otherwise-real manifest —
 * never as a substitute for the frame-size invariants above.
 */
export const DEFAULT_ANIMATION_SPECS: Record<
	CharacterAnimation,
	AnimationSheetSpec
> = {
	idle: { frameCount: 1, fps: 1, loop: true },
	walk: { frameCount: 6, fps: 9, loop: true },
	run: { frameCount: 4, fps: 12, loop: true },
	attack: {
		frameCount: 5,
		fps: 12,
		loop: false,
		durations: [100, 90, 45, 70, 120],
	},
	defend: { frameCount: 2, fps: 3, loop: true },
	critical: { frameCount: 5, fps: 12, loop: false },
	hit: { frameCount: 3, fps: 10, loop: false, durations: [60, 100, 120] },
	stunned: { frameCount: 2, fps: 4, loop: true },
	defeated: { frameCount: 5, fps: 8, loop: false },
	victory: { frameCount: 4, fps: 8, loop: false },
};

export type SpriteCharacterClass = CharacterClass | "trapper";

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

/** Every direction ever passed in narrows to one of the four real facings. */
export function toIsoFacing(dir: IsoFacing | string): IsoFacing {
	switch (dir) {
		case "ne":
		case "nw":
		case "se":
		case "sw":
			return dir;
		default:
			return "se";
	}
}

export interface PlayOptions {
	loop?: boolean;
	onComplete?: () => void;
}
