import { Container, Sprite } from "pixi.js";
import type {
	CharacterAnimation,
	IsoFacing,
	PlayOptions,
	SpriteCharacterClass,
} from "@/types/characterSprite";
import { toIsoFacing } from "@/types/characterSprite";
import {
	loadCharacterAnimation,
	type LoadedAnimationStrip,
} from "@/rendering/characterSprites";
import { getSpriteManifest } from "@/sprites/manifests/brawler";

/**
 * Map token sprite. Feet sit at exactly y=0 in local space always —
 * see FEET_AT_FRAME_BOTTOM in types/characterSprite.ts. There is no
 * per-character vertical offset to tune; if a character's feet don't
 * land on the tile, the source art doesn't follow the convention, not
 * this component.
 *
 * Direction: setDirection() reloads the strip for the current anim at
 * the new IsoFacing. The loader mirrors NE↔NW / SE↔SW when a facing
 * has no authored row (flipX on the strip).
 *
 * Idle uses authored multi-frame strips from the atlas — no runtime bob.
 */
export class CharacterSprite {
	readonly view = new Container();
	private sprite = new Sprite();
	private characterClass: SpriteCharacterClass;
	private currentAnim: CharacterAnimation = "idle";
	private strip: LoadedAnimationStrip | null = null;
	private frameIndex = 0;
	private frameElapsedMs = 0;
	private playing = false;
	private loop = true;
	private onComplete: (() => void) | null = null;
	private direction: IsoFacing = "se";
	private externalScale: number;
	private flipX = false;
	/** Guards against an in-flight play() from an earlier direction overwriting a newer one — see docs/15. */
	private playToken = 0;

	constructor(characterClass: SpriteCharacterClass) {
		this.characterClass = characterClass;
		const manifest = getSpriteManifest(characterClass);
		this.externalScale = manifest.scale;

		// Bottom-center anchor + y=0 is the entire positioning contract —
		// this is what "feet at frame bottom" in the source art buys us.
		this.sprite.anchor.set(0.5, 1);
		this.sprite.y = 0;
		this.view.addChild(this.sprite);
		this.view.visible = false;
	}

	async init(): Promise<boolean> {
		const ok = await this.play("idle");
		this.view.visible = ok;
		if (!ok) {
			console.warn(
				`[CharacterSprite] "${this.characterClass}" has no usable idle sheet — staying on the placeholder token.`,
			);
		}
		return ok;
	}

	get isReady(): boolean {
		return this.view.visible;
	}

	setExternalScale(s: number): void {
		this.externalScale = s;
		this.applyScale();
	}

	setDirection(dir: IsoFacing | string): void {
		const next = toIsoFacing(dir);
		if (this.direction === next) return;
		this.direction = next;
		// Direction is a skin swap, not a restart — the animation's own
		// clock (frameIndex/frameElapsedMs) is deliberately preserved by
		// play()'s preserveProgress path below. Resetting it here was the
		// likely source of visible jitter: any two-frame flicker in the
		// computed facing during movement would otherwise snap the walk
		// cycle back to frame 0 every time, over and over.
		void this.play(
			this.currentAnim,
			{ loop: this.loop, onComplete: this.onComplete ?? undefined },
			/* preserveProgress */ true,
		);
	}

	async play(
		animation: CharacterAnimation,
		options: PlayOptions = {},
		preserveProgress = false,
	): Promise<boolean> {
		const token = ++this.playToken;
		const strip = await loadCharacterAnimation(
			this.characterClass,
			animation,
			this.direction,
		);
		// A newer play()/setDirection() call started while this one was
		// awaiting its asset load — let that newer call win, don't let
		// this stale result overwrite it out of order.
		if (token !== this.playToken) return this.strip !== null;

		if (!strip || strip.frames.length === 0) {
			console.warn(
				`[CharacterSprite] "${this.characterClass}" ${animation}/${this.direction} failed to load.`,
			);
			return false;
		}

		const sameAnim = this.currentAnim === animation && this.strip !== null;
		this.strip = strip;
		this.currentAnim = animation;
		this.flipX = strip.flipX;
		if (!preserveProgress || !sameAnim) {
			this.frameIndex = 0;
			this.frameElapsedMs = 0;
		}
		this.frameIndex = Math.min(this.frameIndex, strip.frames.length - 1);
		this.loop = options.loop ?? strip.loop;
		this.onComplete = options.onComplete ?? null;
		this.playing = true;
		this.sprite.texture = strip.frames[this.frameIndex]!;
		this.applyScale();
		this.view.visible = true;
		return true;
	}

	playAsync(
		animation: CharacterAnimation,
		options: Omit<PlayOptions, "onComplete"> = {},
	): Promise<void> {
		return new Promise((resolve) => {
			void this.play(animation, {
				...options,
				loop: options.loop ?? false,
				onComplete: () => resolve(),
			}).then((ok) => {
				if (!ok) resolve();
			});
		});
	}

	get animation(): CharacterAnimation {
		return this.currentAnim;
	}

	get facing(): IsoFacing {
		return this.direction;
	}

	update(deltaTime: number): void {
		if (!this.playing || !this.strip) return;

		const dtMs = (deltaTime / 60) * 1000;
		const frameMs = this.currentFrameDurationMs();
		this.frameElapsedMs += dtMs;

		while (this.frameElapsedMs >= frameMs) {
			this.frameElapsedMs -= frameMs;
			this.frameIndex += 1;

			if (this.frameIndex >= this.strip.frames.length) {
				if (this.loop) {
					this.frameIndex = 0;
				} else {
					this.frameIndex = this.strip.frames.length - 1;
					this.playing = false;
					const cb = this.onComplete;
					this.onComplete = null;
					cb?.();
					break;
				}
			}

			this.sprite.texture = this.strip.frames[this.frameIndex]!;
		}
	}

	private currentFrameDurationMs(): number {
		if (!this.strip) return 100;
		const d = this.strip.durations;
		if (d && d.length > 0) {
			return d[Math.min(this.frameIndex, d.length - 1)] ?? 100;
		}
		return 1000 / this.strip.fps;
	}

	private applyScale(): void {
		const sign = this.flipX ? -1 : 1;
		this.sprite.scale.x = sign * this.externalScale;
		this.sprite.scale.y = this.externalScale;
	}
}
