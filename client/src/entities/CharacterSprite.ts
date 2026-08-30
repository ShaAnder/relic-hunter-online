import { Container, Sprite } from "pixi.js";
import type {
	CharacterAnimation,
	CharacterDirection,
	SpriteCharacterClass,
} from "@/types/characterSprite";
import { MAP_SPRITE_SCALE } from "@/types/characterSprite";
import {
	loadCharacterAnimation,
	type LoadedAnimationStrip,
} from "@/rendering/characterSprites";

export interface PlayOptions {
	loop?: boolean;
	onComplete?: () => void;
}

// padding to nudge sprite down
const SPRITE_OFFSET_Y = 4;

/**
 * Parameterized map sprite. Anchor (0.5, 1) = feet on tile.
 * Parent (Mercenary.view) owns world position.
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
	private externalScale = MAP_SPRITE_SCALE;
	private flipX = false;

	constructor(characterClass: SpriteCharacterClass) {
		this.characterClass = characterClass;
		this.sprite.anchor.set(0.5, 1);
		this.sprite.y = SPRITE_OFFSET_Y;
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

	setDirection(dir: CharacterDirection): void {
		if (this.direction === dir) return;
		this.direction = dir;
		// Reload strip for the new facing (different file may apply).
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

		this.strip = strip;
		this.currentAnim = animation;
		this.flipX = strip.flipX;
		this.frameIndex = 0;
		this.elapsedMs = 0;
		this.loop = options.loop ?? strip.loop;
		this.onComplete = options.onComplete ?? null;
		this.playing = true;
		this.sprite.texture = strip.frames[0]!;
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

			this.sprite.texture = this.strip.frames[this.frameIndex]!;
		}
	}

	private applyScale(): void {
		const sign = this.flipX ? -1 : 1;
		this.sprite.scale.x = sign * this.externalScale;
		this.sprite.scale.y = this.externalScale;
	}
}
