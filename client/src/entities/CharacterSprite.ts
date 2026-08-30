import { Container, Sprite } from "pixi.js";
import type {
	CharacterAnimation,
	CharacterDirection,
	SpriteCharacterClass,
} from "@/types/characterSprite";
import {
	directionMirrorSource,
	directionUsesFlipX,
} from "@/math/characterDirection";
import {
	loadCharacterAnimation,
	type LoadedAnimationStrip,
} from "@/rendering/characterSprites";

export interface PlayOptions {
	loop?: boolean;
	/** Fired once when a non-looping anim finishes (or is interrupted). */
	onComplete?: () => void;
}

/**
 * One parameterized sprite for any characterClass — not Brawler extends …
 * Anchor (0.5, 1): feet on the iso tile center, same pivot idea as Card.
 * Does not own world position — parent (Mercenary.view) does.
 */
export class CharacterSprite {
	readonly view = new Container();
	private sprite = new Sprite();
	private characterClass: SpriteCharacterClass;
	private currentAnim: CharacterAnimation = "idle";
	private strip: LoadedAnimationStrip | null = null;
	private frameIndex = 0;
	private elapsedMs = 0;
	private playing = false;
	private loop = true;
	private onComplete: (() => void) | null = null;
	private direction: CharacterDirection = "se";
	/** Optional external scale (BattleOverlay UI scale later). */
	private externalScale = 1;

	constructor(characterClass: SpriteCharacterClass) {
		this.characterClass = characterClass;
		this.sprite.anchor.set(0.5, 1);
		this.view.addChild(this.sprite);
		this.view.visible = false;
	}

	/** Load idle so something shows; call once after construct. */
	async init(): Promise<boolean> {
		const ok = await this.play("idle");
		this.view.visible = ok;
		return ok;
	}

	setExternalScale(s: number): void {
		this.externalScale = s;
		this.applyScale();
	}

	setDirection(dir: CharacterDirection): void {
		this.direction = dir;
		const flip = directionUsesFlipX(dir);
		// Mirror pairing reserved for multi-angle sheets; SE-only sheets
		// still flip for west-ish facings so silhouette isn't locked SE.
		void directionMirrorSource(dir);
		this.sprite.scale.x = (flip ? -1 : 1) * this.externalScale;
		this.sprite.scale.y = this.externalScale;
	}

	/**
	 * Switch animation. Returns false if sheet missing (keep placeholder).
	 */
	async play(
		animation: CharacterAnimation,
		options: PlayOptions = {},
	): Promise<boolean> {
		const strip = await loadCharacterAnimation(
			this.characterClass,
			animation,
		);
		if (!strip || strip.frames.length === 0) return false;

		this.strip = strip;
		this.currentAnim = animation;
		this.frameIndex = 0;
		this.elapsedMs = 0;
		this.loop = options.loop ?? strip.loop;
		this.onComplete = options.onComplete ?? null;
		this.playing = true;
		this.sprite.texture = strip.frames[0];
		this.applyScale();
		this.view.visible = true;
		return true;
	}

	/** Promise that resolves when a one-shot finishes (combat sequencing). */
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

	/** Advance frames — call from Mercenary.update / scene tick. */
	update(deltaTime: number): void {
		if (!this.playing || !this.strip) return;
		const frameMs = 1000 / this.strip.fps;
		this.elapsedMs += (deltaTime / 60) * 1000;

		while (this.elapsedMs >= frameMs) {
			this.elapsedMs -= frameMs;
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

			this.sprite.texture = this.strip.frames[this.frameIndex];
		}
	}

	private applyScale(): void {
		const flip = directionUsesFlipX(this.direction);
		this.sprite.scale.x = (flip ? -1 : 1) * this.externalScale;
		this.sprite.scale.y = this.externalScale;
	}
}
