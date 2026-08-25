import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import { computeUiScale, uiPx } from "@/math/uiScale";
import type { DialogueLine } from "@/tutorial/dialogue";
import {
	hasRealPortrait,
	loadPortraitTexture,
	needsFlipForSide,
} from "@/ui/portraits";

const STRIP_HEIGHT = 160;
const PORTRAIT_TARGET_HEIGHT = 340;
const PLACEHOLDER_SIZE = 110;
const MARGIN = 24;
const TEXT_PORTRAIT_GAP = 24;
const ADVANCE_CARET_PULSE_SPEED = 0.005;
/** DialogueOverlay currently only ever renders a portrait on the right — needsFlipForSide is called against this constant. When left-side speakers (per the initiator/recipient design) actually get built, this becomes a per-line value instead. */
const PORTRAIT_SIDE = "right" as const;

const PLACEHOLDER_COLORS: Record<string, number> = {
	narrator: 0x4a9eff,
	default: 0x888888,
};

function colorForPortrait(portraitId: string): number {
	return PLACEHOLDER_COLORS[portraitId] ?? PLACEHOLDER_COLORS.default;
}

/**
 * Talking-head dialogue system — a large portrait standing on the
 * right, visibly taller than the strip itself so it reads as a
 * character standing behind/on top of it rather than boxed inside it.
 * The strip runs the full screen width behind the portrait. Tap
 * anywhere on the strip to advance. Portrait art comes from the
 * glob-based factory in tutorial/portraits.ts — no hardcoded per-file
 * imports here, and any character with no real art yet falls back to
 * a colored placeholder automatically.
 * @author ShaAnder
 */
export class DialogueOverlay implements Overlay {
	readonly view = new Container();
	readonly blocksEscape = true;

	private strip = new Graphics();
	private portraitSprite: Sprite | null = null;
	private placeholderBg = new Graphics();
	private placeholderLabel!: Text;
	private nameText!: Text;
	private bodyText!: Text;
	private advanceCaret!: Text;
	private hitArea = new Graphics();

	private caretElapsedMs = 0;
	private advanceResolve: (() => void) | null = null;
	/** Width (design px) the currently-shown portrait actually occupies at PORTRAIT_TARGET_HEIGHT — text wrap width is computed against this per-line, since different expressions/characters can be genuinely different widths at the same target height. */
	private currentPortraitWidth = PLACEHOLDER_SIZE;

	constructor(private game: Game) {
		this.view.addChild(this.strip);

		this.placeholderBg.visible = false;
		this.view.addChild(this.placeholderBg);

		this.placeholderLabel = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 48, fontWeight: "bold" },
		});
		this.placeholderLabel.anchor.set(0.5);
		this.placeholderLabel.visible = false;
		this.view.addChild(this.placeholderLabel);

		this.nameText = new Text({
			text: "",
			style: { fill: 0xffd700, fontSize: 26, fontWeight: "bold" },
		});
		this.view.addChild(this.nameText);

		this.bodyText = new Text({
			text: "",
			style: {
				fill: 0xffffff,
				fontSize: 24,
				wordWrap: true,
				wordWrapWidth: 600,
				lineHeight: 32,
			},
		});
		this.view.addChild(this.bodyText);

		this.advanceCaret = new Text({
			text: "▼",
			style: { fill: 0xaaaaaa, fontSize: 18 },
		});
		this.advanceCaret.anchor.set(0.5);
		this.view.addChild(this.advanceCaret);

		this.hitArea.eventMode = "static";
		this.hitArea.cursor = "pointer";
		this.hitArea.on("pointerdown", () => this.handleAdvance());
		this.view.addChild(this.hitArea);
	}

	onShow(): void {
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onHide(): void {
		this.advanceResolve?.();
		this.advanceResolve = null;
	}

	update(deltaTime: number): void {
		const deltaMs = (deltaTime / 60) * 1000;
		this.caretElapsedMs += deltaMs;
		this.advanceCaret.alpha =
			0.5 +
			Math.abs(Math.sin(this.caretElapsedMs * ADVANCE_CARET_PULSE_SPEED)) * 0.5;
	}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	async playLines(lines: DialogueLine[]): Promise<void> {
		for (const line of lines) {
			await this.showLine(line);
			await this.waitForAdvance();
		}
	}

	private async showLine(line: DialogueLine): Promise<void> {
		this.nameText.text = line.speaker;
		this.bodyText.text = line.text;

		if (hasRealPortrait(line.portraitId)) {
			this.placeholderBg.visible = false;
			this.placeholderLabel.visible = false;

			const texture = await loadPortraitTexture(line.portraitId);
			if (!this.portraitSprite) {
				this.portraitSprite = new Sprite();
				this.portraitSprite.anchor.set(1, 1);
				this.view.addChild(this.portraitSprite);
			}
			this.portraitSprite.texture = texture;
			const baseScale = PORTRAIT_TARGET_HEIGHT / texture.height;
			const flip = needsFlipForSide(line.portraitId, PORTRAIT_SIDE);
			this.portraitSprite.scale.set(flip ? -baseScale : baseScale, baseScale);
			this.currentPortraitWidth = texture.width * baseScale;
		} else {
			if (this.portraitSprite) this.portraitSprite.visible = false;
			this.placeholderBg.visible = true;
			this.placeholderLabel.visible = true;
			this.placeholderLabel.text = line.speaker.charAt(0).toUpperCase();
			this.placeholderBg.clear();
			this.placeholderBg.roundRect(0, 0, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, 8);
			this.placeholderBg.fill(colorForPortrait(line.portraitId));
			this.currentPortraitWidth = PLACEHOLDER_SIZE;
		}

		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	private waitForAdvance(): Promise<void> {
		return new Promise((resolve) => {
			this.advanceResolve = resolve;
		});
	}

	private handleAdvance(): void {
		this.advanceResolve?.();
		this.advanceResolve = null;
	}

	private layout(width: number, height: number): void {
		const s = computeUiScale(width, height);
		const stripH = uiPx(STRIP_HEIGHT, s);
		const margin = uiPx(MARGIN, s);
		const gap = uiPx(TEXT_PORTRAIT_GAP, s);
		const stripY = height - stripH;

		this.strip.clear();
		this.strip.rect(0, stripY, width, stripH);
		this.strip.fill({ color: 0x0a0a0a, alpha: 0.92 });

		const portraitW = uiPx(this.currentPortraitWidth, s);
		if (this.portraitSprite && this.portraitSprite.texture) {
			this.portraitSprite.visible = true;
			const flipped = this.portraitSprite.scale.x < 0;
			const targetH = uiPx(PORTRAIT_TARGET_HEIGHT, s);
			const mag = targetH / this.portraitSprite.texture.height;
			this.portraitSprite.scale.set(flipped ? -mag : mag, mag);
			this.portraitSprite.x = width - margin * 0.4;
			this.portraitSprite.y = height;
		} else {
			const placeholderSize = uiPx(PLACEHOLDER_SIZE, s);
			this.placeholderBg.x = width - margin - placeholderSize;
			this.placeholderBg.y = stripY + (stripH - placeholderSize) / 2;
			this.placeholderBg.scale.set(s);
			this.placeholderLabel.x = width - margin - placeholderSize / 2;
			this.placeholderLabel.y = stripY + stripH / 2;
			this.placeholderLabel.scale.set(s);
		}

		this.nameText.x = margin;
		this.nameText.y = stripY + margin;
		this.nameText.scale.set(s);

		this.bodyText.x = margin;
		this.bodyText.y = stripY + margin + uiPx(40, s);
		this.bodyText.scale.set(s);
		const portraitLeftEdge = width - margin * 0.4 - portraitW;
		this.bodyText.style.wordWrapWidth = (portraitLeftEdge - gap - margin) / s;

		this.advanceCaret.x = width - margin - uiPx(10, s);
		this.advanceCaret.y = height - uiPx(16, s);
		this.advanceCaret.scale.set(s);

		this.hitArea.clear();
		this.hitArea.rect(0, stripY, width, stripH);
		this.hitArea.fill({ color: 0xffffff, alpha: 0.001 });
	}
}
