/**
 * Minimal audio playback — keyed tracks, play/stop, nothing fancier yet.
 * Rough-and-ready for testing; a real music/SFX system (crossfading,
 * volume mixing, preloading) is its own future pass, not this.
 * @author ShaAnder
 */
export class AudioController {
	private tracks = new Map<string, HTMLAudioElement>();

	play(
		key: string,
		src: string,
		options: { loop?: boolean; volume?: number } = {},
	): void {
		let audio = this.tracks.get(key);
		if (!audio) {
			audio = new Audio(src);
			this.tracks.set(key, audio);
		}
		audio.loop = options.loop ?? false;
		audio.volume = options.volume ?? 1;
		audio.currentTime = 0;
		void audio.play();
	}

	stop(key: string): void {
		const audio = this.tracks.get(key);
		if (!audio) return;
		audio.pause();
		audio.currentTime = 0;
	}
}
