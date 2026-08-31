import { Container, Sprite } from "pixi.js";
import type {
	CharacterAnimation,
	CharacterDirection,
	IsoFacing,
	SpriteCharacterClass,
} from "@/types/characterSprite";
import { toIsoFacing } from "@/types/characterSprite";
import {
	loadCharacterAnimation,
	type LoadedAnimationStrip,
} from "@/rendering/characterSprites";
import { getSpriteManifest } from "@/sprites/manifests/brawler";

export interface PlayOptions {
	loop?: boolean;
	onComplete?: () => void;
}

/**
 * Map token sprite — feet anchor, manifest scale/offset, optional runtime idle bob.
 */
export class CharacterSprite {
	readonly view = new Container();
	private sprite = new Sprite();
	private characterClass: SpriteCharacterClass;
	private currentAnim: CharacterAnimation = "idle";
	private strip: LoadedAnimationStrip | null = null;
	private frameIndex = 0;
	private elapsedMs = 0;
	private frameElapsedMs = 0;
	private playing = false;
	private loop = true;
	private onComplete: (() => void) | null = null;
	private direction: IsoFacing = "se";
	private externalScale: number;
	private flipX = false;
	private baseY: number;
	private runtimeIdle = false;
	private idleBobY: number[];
	private idleBobPeriodMs: number;
	private idleBobElapsedMs = 0;

	constructor(characterClass: SpriteCharacterClass) {
		this.characterClass = characterClass;
		const manifest = getSpriteManifest(characterClass);
		this.externalScale = manifest.scale;
		this.baseY = manifest.footOffsetY;
		this.idleBobY = manifest.idleBobY;
		this.idleBobPeriodMs = manifest.idleBobPeriodMs;

		this.sprite.anchor.set(0.5, 1);
		this.sprite.y = this.baseY;
		this.view.addChild(this.sprite);
		this.view.visible = false;
	}

	async init(): Promise<boolean> {
		const ok = await this.play("idle");
		this.view.visible = ok;
		return ok;
	}

	setExternalScale(s: number): void {
		this.externalScale = s;
		this.applyScale();
	}

	setDirection(dir: CharacterDirection | IsoFacing): void {
		const next = toIsoFacing(dir);
		if (this.direction === next) return;
		this.direction = next;
		void this.play(this.currentAnim, {
			loop: this.loop,
			onComplete: this.onComplete ?? undefined,
		});
	}

	async play(
		animation: CharacterAnimation,
		options: PlayOptions = {},
	): Promise<boolean> {
		const strip = await loadCharacterAnimation(
			this.characterClass,
			animation,
			this.direction,
		);
		if (!strip || strip.frames.length === 0) return false;

		const manifest = getSpriteManifest(this.characterClass);
		const animMeta = manifest.animations[animation];
		this.runtimeIdle = !!animMeta?.runtimeIdle && animation === "idle";

		this.strip = strip;
		this.currentAnim = animation;
		this.flipX = strip.flipX;
		this.frameIndex = 0;
		this.elapsedMs = 0;
		this.frameElapsedMs = 0;
		this.idleBobElapsedMs = 0;
		this.loop = options.loop ?? strip.loop;
		this.onComplete = options.onComplete ?? null;
		this.playing = true;
		this.sprite.texture = strip.frames[0]!;
		this.sprite.y = this.baseY;
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
			const t =
				(this.idleBobElapsedMs % this.idleBobPeriodMs) / this.idleBobPeriodMs;
			const idx = Math.min(
				this.idleBobY.length - 1,
				Math.floor(t * this.idleBobY.length),
			);
			const bob = this.idleBobY[idx] ?? 0;
			this.sprite.y = this.baseY + bob;
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
