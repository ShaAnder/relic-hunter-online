/**
 * Character sprite types — map tokens only for phase 1.
 * Matches docs/15-character-sprite-system-design.md.
 */

/** Eight compass facings. Art is authored for SE; others via rotation table + flipX. */
export type CharacterDirection =
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w"
	| "nw";

/**
 * Animations we expect to generate. Phase 1 only needs idle + walk on the map;
 * combat names are reserved so sheets can be authored once.
 */
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

/** Native frame size — matches TILE_WIDTH (64) footprint, tall humanoid. */
export const SPRITE_FRAME_WIDTH = 64;
export const SPRITE_FRAME_HEIGHT = 96;

export interface AnimationSheetSpec {
	/** Frames in this strip (left → right). */
	frameCount: number;
	/** Frame rate while playing. */
	fps: number;
	/** Loop unless combat one-shots. */
	loop: boolean;
}

/** Default playback specs — tune once real PixelLab strips land. */
export const DEFAULT_ANIMATION_SPECS: Record<
	CharacterAnimation,
	AnimationSheetSpec
> = {
	idle: { frameCount: 4, fps: 6, loop: true },
	walk: { frameCount: 6, fps: 10, loop: true },
	run: { frameCount: 6, fps: 12, loop: true },
	attack: { frameCount: 5, fps: 12, loop: false },
	critical: { frameCount: 5, fps: 12, loop: false },
	hit: { frameCount: 3, fps: 10, loop: false },
	stunned: { frameCount: 4, fps: 6, loop: true },
	defeated: { frameCount: 4, fps: 8, loop: false },
	victory: { frameCount: 4, fps: 8, loop: false },
};

/**
 * Classes that will eventually have sheets. First pass: brawler only.
 * Keep the union wide so the registry can grow without API churn.
 */
export type SpriteCharacterClass =
	| "brawler"
	| "hunter"
	| "scout"
	| "tank"
	| "mage"
	| "summoner"
	| "trapper";

/** Narrow shared class strings into a sprite key; unknown → brawler. */
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
