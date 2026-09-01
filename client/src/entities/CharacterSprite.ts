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
	private runtimeIdle = false;
	private idleBobY: number[];
	private idleBobPeriodMs: number;
	private idleBobElapsedMs = 0;
	/** Guards against an in-flight play() from an earlier direction overwriting a newer one — see docs/15. */
	private playToken = 0;

	constructor(characterClass: SpriteCharacterClass) {
		this.characterClass = characterClass;
		const manifest = getSpriteManifest(characterClass);
		this.externalScale = manifest.scale;
		this.idleBobY = manifest.idleBobY;
		this.idleBobPeriodMs = manifest.idleBobPeriodMs;

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

		const manifest = getSpriteManifest(this.characterClass);
		const animMeta = manifest.animations[animation];
		this.runtimeIdle = !!animMeta?.runtimeIdle && animation === "idle";

		const sameAnim = this.currentAnim === animation && this.strip !== null;
		this.strip = strip;
		this.currentAnim = animation;
		this.flipX = strip.flipX;
		if (!preserveProgress || !sameAnim) {
			this.frameIndex = 0;
			this.frameElapsedMs = 0;
			this.idleBobElapsedMs = 0;
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

	update(deltaTime: number): void {
		const dtMs = (deltaTime / 60) * 1000;

		if (this.runtimeIdle) {
			this.idleBobElapsedMs += dtMs;
			this.sprite.y = Math.round(this.sampleIdleBob());
			return;
		}

		if (!this.playing || !this.strip) return;

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

	/**
	 * Smoothly interpolates between the manifest's idleBobY keyframes
	 * instead of stepping discretely between them — a discrete lookup
	 * here was a second, independent source of visible jitter, since
	 * each step is a hard snap rather than a continuous motion.
	 */
	private sampleIdleBob(): number {
		if (this.idleBobY.length === 0) return 0;
		if (this.idleBobY.length === 1) return this.idleBobY[0]!;

		const t =
			(this.idleBobElapsedMs % this.idleBobPeriodMs) / this.idleBobPeriodMs;
		const scaled = t * this.idleBobY.length;
		const i0 = Math.floor(scaled) % this.idleBobY.length;
		const i1 = (i0 + 1) % this.idleBobY.length;
		const localT = scaled - Math.floor(scaled);

		const a = this.idleBobY[i0]!;
		const b = this.idleBobY[i1]!;
		return a + (b - a) * localT;
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
