/**
 * Audio manifest — the library catalogue.
 *
 * Call sites never pass file paths. They pass an AudioId.
 * Paths, loop flags, and default volumes live here only.
 *
 * Put files in: client/public/audio/
 *   e.g. public/audio/music/map-theme.mp3
 *        public/audio/sfx/attack.mp3
 *
 * URLs are root-relative from the site origin (/audio/...).
 */

export type MusicId = "menu" | "map" | "battle" | "boss" | "end";
export type SfxId = "attack" | "item-pickup" | "ui-click";

export type AudioId = MusicId | SfxId;

export interface MusicTrackDef {
	id: MusicId;
	/** Root-relative URL under public/ */
	src: string;
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
		src: "/audio/music/menu-theme.mp3",
		volume: 0.45,
	},
	map: {
		id: "map",
		src: "/audio/music/map-theme.mp3",
		volume: 0.4,
	},
	battle: {
		id: "battle",
		src: "/audio/music/battle-theme.mp3",
		volume: 0.45,
	},
	boss: {
		id: "boss",
		src: "/audio/music/boss-theme.mp3",
		volume: 0.5,
	},
	end: {
		id: "end",
		src: "/audio/music/end-theme.mp3",
		volume: 0.4,
	},
};

/** Short one-shots — many may overlap. */
export const SFX: Record<SfxId, SfxDef> = {
	attack: {
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
