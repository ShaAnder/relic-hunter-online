/**
 * Audio manifest — the library catalogue.
 *
 * Call sites never pass file paths. They pass an AudioId.
 * Paths, loop flags, and default volumes live here only.
 *
 * Put files in: client/public/audio/
 *   e.g. public/audio/music/menu.mp3
 *        public/audio/sfx/attack.mp3
 *
 * URLs are root-relative from the site origin (/audio/...).
 */

export type MusicId = "menu" | "map" | "battle" | "boss" | "end";
export type SfxId = "attack" | "item-pickup" | "ui-click";

export type AudioId = MusicId | SfxId;

export interface MusicTrackDef {
	id: MusicId;
	/**
	 * Root-relative URL(s) under public/. A single string plays that
	 * one file every time. An array is a *pool* — one is chosen at
	 * random each time this id is triggered, so e.g. the map theme can
	 * vary between playthroughs instead of always being the same file.
	 * This is picked once per playMusic() call, not re-picked mid-loop.
	 */
	src: string | string[];
	/** 0–1; multiplied by music category volume */
	volume?: number;
}

export interface SfxDef {
	id: SfxId;
	src: string;
	volume?: number;
}

/** Background / stinger-style loops — one logical track at a time. */
export const MUSIC_TRACKS: Record<MusicId, MusicTrackDef> = {
	menu: {
		id: "menu",
		src: "/audio/music/menu.mp3",
		volume: 0.45,
	},
	map: {
		id: "map",
		// A pool, not a single file — every time the map theme starts,
		// one of these is picked at random
		src: ["/audio/music/level.mp3", "/audio/music/level2.mp3"],
		volume: 0.4,
	},
	battle: {
		id: "battle",
		src: "/audio/music/battle.mp3",
		volume: 0.45,
	},
	boss: {
		id: "boss",
		src: "/audio/music/boss.mp3",
		volume: 0.5,
	},
	end: {
		id: "end",
		src: "/audio/music/results.mp3",
		volume: 0.4,
	},
};

/** Short one-shots — many may overlap. */
export const SFX: Record<SfxId, SfxDef> = {
	"attack": {
		id: "attack",
		src: "/audio/sfx/attack.mp3",
		volume: 0.7,
	},
	"item-pickup": {
		id: "item-pickup",
		src: "/audio/sfx/item-pickup.mp3",
		volume: 0.65,
	},
	"ui-click": {
		id: "ui-click",
		src: "/audio/sfx/ui-click.mp3",
		volume: 0.5,
	},
};

/** Default crossfade length for music switches (ms). */
export const MUSIC_CROSSFADE_MS = 1200;
