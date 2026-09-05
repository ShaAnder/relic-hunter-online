/**
 * AudioService — game-wide mixer (music bus + sfx bus).
 *
 * Lifetime: construct ONCE on Game. Scenes only call playMusic / playSfx.
 *
 * Mental model:
 *   - Music: one logical track. playMusic("battle") crossfades from
 *     whatever is current. playMusic(same id) is a no-op when already playing.
 *   - SFX: independent Howls; fire-and-forget; never stop music.
 *   - Unlock: browsers block audio until a user gesture. Call unlock()
 *     from the first pointer/key handler (Game or input bootstrap).
 *
 * Howler uses Web Audio under the hood. We keep two Howl instances for
 * music so we can fade A out and B in at the same time (true crossfade).
 */

import { Howl, Howler } from "howler";
import {
	MUSIC_CROSSFADE_MS,
	MUSIC_TRACKS,
	SFX,
	type MusicId,
	type SfxId,
} from "./audioManifest";

/** localStorage key — bump this suffix if the saved shape ever changes incompatibly, so old saves don't get misread. */
const STORAGE_KEY = "rh_audio_settings_v1";

interface StoredVolumes {
	masterVolume: number;
	musicVolume: number;
	sfxVolume: number;
}

export interface AudioServiceOptions {
	masterVolume?: number;
	musicVolume?: number;
	sfxVolume?: number;
}

export class AudioService {
	private unlocked = false;
	private masterVolume: number;
	private musicVolume: number;
	private sfxVolume: number;

	private currentMusicId: MusicId | null = null;

	private musicA: Howl | null = null;
	private musicB: Howl | null = null;
	private musicPrimary: "a" | "b" = "a";

	private sfxCache = new Map<SfxId, Howl>();

	constructor(opts: AudioServiceOptions = {}) {
		// Saved values (if any) win over the constructor defaults —
		// this is what makes a volume choice survive a page reload.
		const saved = loadVolumes();
		this.masterVolume = saved?.masterVolume ?? opts.masterVolume ?? 1;
		this.musicVolume = saved?.musicVolume ?? opts.musicVolume ?? 1;
		this.sfxVolume = saved?.sfxVolume ?? opts.sfxVolume ?? 1;
		this.applyMaster();
	}

	/**
	 * Call once from a user gesture (click / key / touch).
	 * Safe to call repeatedly.
	 */
	unlock(): void {
		if (this.unlocked) return;
		this.unlocked = true;
		try {
			Howler.ctx?.resume?.();
		} catch {
			// ignore
		}
	}

	get isUnlocked(): boolean {
		return this.unlocked;
	}

	setMasterVolume(v: number): void {
		this.masterVolume = clamp01(v);
		this.applyMaster();
		this.saveVolumes();
	}

	setMusicVolume(v: number): void {
		this.musicVolume = clamp01(v);
		this.applyMusicVolumesImmediate();
		this.saveVolumes();
	}

	setSfxVolume(v: number): void {
		this.sfxVolume = clamp01(v);
		this.saveVolumes();
	}

	getMasterVolume(): number {
		return this.masterVolume;
	}

	getMusicVolume(): number {
		return this.musicVolume;
	}

	getSfxVolume(): number {
		return this.sfxVolume;
	}

	private saveVolumes(): void {
		saveVolumes({
			masterVolume: this.masterVolume,
			musicVolume: this.musicVolume,
			sfxVolume: this.sfxVolume,
		});
	}

	private applyMaster(): void {
		Howler.volume(this.masterVolume);
	}

	private musicBusLevel(trackVol: number): number {
		return clamp01(trackVol * this.musicVolume);
	}

	private sfxBusLevel(trackVol: number): number {
		return clamp01(trackVol * this.sfxVolume);
	}

	private applyMusicVolumesImmediate(): void {
		const id = this.currentMusicId;
		if (!id) return;
		const def = MUSIC_TRACKS[id];
		const level = this.musicBusLevel(def.volume ?? 1);
		const primary = this.musicPrimary === "a" ? this.musicA : this.musicB;
		primary?.volume(level);
	}

	/**
	 * Switch music program with crossfade. Same id while playing → no-op.
	 */
	playMusic(id: MusicId, crossfadeMs: number = MUSIC_CROSSFADE_MS): void {
		this.unlock();

		if (this.currentMusicId === id) {
			const primary = this.musicPrimary === "a" ? this.musicA : this.musicB;
			if (primary?.playing()) return;
		}

		const def = MUSIC_TRACKS[id];
		if (!def) {
			console.warn(`[AudioService] Unknown music id: ${id}`);
			return;
		}

		const targetVol = this.musicBusLevel(def.volume ?? 1);
		const chosenSrc = pickOne(def.src);
		const incoming = new Howl({
			src: [chosenSrc],
			loop: true,
			html5: false,
			preload: true,
			volume: 0,
		});

		const outgoing = this.musicPrimary === "a" ? this.musicA : this.musicB;
		const nextSlot: "a" | "b" = this.musicPrimary === "a" ? "b" : "a";

		if (nextSlot === "a") this.musicA = incoming;
		else this.musicB = incoming;

		incoming.play();

		const fade = Math.max(0, crossfadeMs);

		if (outgoing && outgoing.playing() && fade > 0) {
			const fromVol = outgoing.volume();
			outgoing.fade(fromVol, 0, fade);
			incoming.fade(0, targetVol, fade);
			const outRef = outgoing;
			window.setTimeout(() => {
				outRef.stop();
				outRef.unload();
			}, fade + 50);
		} else {
			incoming.volume(targetVol);
			if (outgoing) {
				outgoing.stop();
				outgoing.unload();
			}
		}

		this.musicPrimary = nextSlot;
		this.currentMusicId = id;
	}

	stopMusic(fadeMs: number = MUSIC_CROSSFADE_MS): void {
		const primary = this.musicPrimary === "a" ? this.musicA : this.musicB;
		if (!primary) {
			this.currentMusicId = null;
			return;
		}
		if (fadeMs <= 0) {
			primary.stop();
			primary.unload();
		} else {
			primary.fade(primary.volume(), 0, fadeMs);
			const ref = primary;
			window.setTimeout(() => {
				ref.stop();
				ref.unload();
			}, fadeMs + 50);
		}
		this.currentMusicId = null;
		if (this.musicPrimary === "a") this.musicA = null;
		else this.musicB = null;
	}

	getCurrentMusicId(): MusicId | null {
		return this.currentMusicId;
	}

	/** One-shot SFX; overlaps freely; does not touch music. */
	playSfx(id: SfxId): void {
		this.unlock();

		const def = SFX[id];
		if (!def) {
			console.warn(`[AudioService] Unknown sfx id: ${id}`);
			return;
		}

		let howl = this.sfxCache.get(id);
		const vol = this.sfxBusLevel(def.volume ?? 1);
		if (!howl) {
			howl = new Howl({
				src: [def.src],
				loop: false,
				preload: true,
				volume: vol,
			});
			this.sfxCache.set(id, howl);
		} else {
			howl.volume(vol);
		}

		howl.play();
	}

	/** Optional: call from a loading screen to warm decoders. */
	preloadAll(): void {
		for (const def of Object.values(MUSIC_TRACKS)) {
			for (const src of toArray(def.src)) {
				void new Howl({ src: [src], preload: true, volume: 0 });
			}
		}
		for (const def of Object.values(SFX)) {
			if (this.sfxCache.has(def.id)) continue;
			this.sfxCache.set(
				def.id,
				new Howl({ src: [def.src], preload: true, volume: 0 }),
			);
		}
	}
}

/** Normalizes a single-src-or-pool into an array — makes "loop over every file" the same code whether there's one file or several. */
function toArray(src: string | string[]): string[] {
	return Array.isArray(src) ? src : [src];
}

/** Picks one entry from a single-src-or-pool. A plain string just passes through untouched — only an actual pool involves any randomness. */
function pickOne(src: string | string[]): string {
	if (!Array.isArray(src)) return src;
	return src[Math.floor(Math.random() * src.length)];
}

/**
 * localStorage can throw — some browsers disable it entirely in
 * private/incognito modes, and it's technically a synchronous API that
 * can fail on quota or permission grounds. A failed read just means
 * "no saved settings," a failed write just means "this session's
 * choice won't persist" — neither should ever break audio playback
 * itself, so both are wrapped and degrade silently.
 */
function loadVolumes(): StoredVolumes | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredVolumes>;
		if (
			typeof parsed.masterVolume !== "number" ||
			typeof parsed.musicVolume !== "number" ||
			typeof parsed.sfxVolume !== "number"
		) {
			return null;
		}
		return parsed as StoredVolumes;
	} catch {
		return null;
	}
}

function saveVolumes(volumes: StoredVolumes): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(volumes));
	} catch {
		// Ignore — this session just won't remember the choice.
	}
}

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}
