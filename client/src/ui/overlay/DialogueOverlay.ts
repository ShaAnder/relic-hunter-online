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
/** Gap from the actual screen edge to the portrait's own edge — not its center. */
const EDGE_MARGIN = 10;
const TEXT_GAP = 24;
const ADVANCE_CARET_PULSE_SPEED = 0.005;

const PLACEHOLDER_COLORS: Record<string, number> = {
	narrator: 0x4a9eff,
	default: 0x888888,
};

function colorForPortrait(portraitId: string): number {
	return PLACEHOLDER_COLORS[portraitId] ?? PLACEHOLDER_COLORS.default;
}

/** One side's portrait — a real Sprite once art loads, or a colored placeholder fallback. Two of these exist (left, right), updated independently per line so whichever side last spoke stays visible when the other side starts talking. */
class PortraitSlot {
	readonly view = new Container();
	private sprite: Sprite | null = null;
	private placeholderBg = new Graphics();
	private placeholderLabel: Text;
	/** Width (design px) this slot currently occupies at PORTRAIT_TARGET_HEIGHT — text layout reads this to know how much horizontal space this side is actually using. */
	width = 0;
	active = false;

	constructor(private side: "left" | "right") {
		this.placeholderBg.visible = false;
		this.view.addChild(this.placeholderBg);

		this.placeholderLabel = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 48, fontWeight: "bold" },
		});
		this.placeholderLabel.anchor.set(0.5);
		this.placeholderLabel.visible = false;
		this.view.addChild(this.placeholderLabel);
	}

	async show(line: DialogueLine): Promise<void> {
		this.active = true;

		if (hasRealPortrait(line.portraitId)) {
			this.placeholderBg.visible = false;
			this.placeholderLabel.visible = false;

			const texture = await loadPortraitTexture(line.portraitId);
			if (!this.sprite) {
				this.sprite = new Sprite();
				// Symmetric anchor — an asymmetric anchor like (1,1)
				// combined with a negated scale.x for flipping mirrors the
				// image AROUND that anchor point, pushing the visual bounds
				// to the opposite side. Centered horizontally, the mirror
				// stays in place regardless of flip.
				this.sprite.anchor.set(0.5, 1);
				this.view.addChild(this.sprite);
			}
			this.sprite.visible = true;
			this.sprite.texture = texture;
			const flip = needsFlipForSide(line.portraitId, this.side);
			const mag = PORTRAIT_TARGET_HEIGHT / texture.height;
			this.sprite.scale.set(flip ? -mag : mag, mag);
			this.width = texture.width * mag;
		} else {
			if (this.sprite) this.sprite.visible = false;
			this.placeholderBg.visible = true;
			this.placeholderLabel.visible = true;
			this.placeholderLabel.text = line.speaker.charAt(0).toUpperCase();
			this.placeholderBg.clear();
			this.placeholderBg.roundRect(
				-PLACEHOLDER_SIZE / 2,
				-PLACEHOLDER_SIZE,
				PLACEHOLDER_SIZE,
				PLACEHOLDER_SIZE,
				8,
			);
			this.placeholderBg.fill(colorForPortrait(line.portraitId));
			this.width = PLACEHOLDER_SIZE;
		}
	}

	/**
	 * Positions this slot's edge EDGE_MARGIN away from the actual
	 * screen edge — not its center pinned to the edge. With a
	 * horizontally-centered anchor, that means the sprite/placeholder's
	 * own CENTER needs to sit half its own rendered width further in
	 * from the edge than the margin alone, which is why this is
	 * computed after the rendered width is known, not before.
	 */
	layout(width: number, height: number, s: number): void {
		const targetH = uiPx(PORTRAIT_TARGET_HEIGHT, s);
		const edgeMargin = uiPx(EDGE_MARGIN, s);

		if (this.sprite && this.sprite.texture) {
			const flipped = this.sprite.scale.x < 0;
			const mag = targetH / this.sprite.texture.height;
			this.sprite.scale.set(flipped ? -mag : mag, mag);
			const renderedW = this.sprite.texture.width * mag;
			this.width = renderedW;
			this.sprite.x =
				this.side === "right"
					? width - edgeMargin - renderedW / 2
					: edgeMargin + renderedW / 2;
			this.sprite.y = height;
		} else {
			const size = uiPx(PLACEHOLDER_SIZE, s);
			this.width = size;
			const cx =
				this.side === "right"
					? width - edgeMargin - size / 2
					: edgeMargin + size / 2;
			this.placeholderBg.x = cx;
			this.placeholderBg.y = height;
			this.placeholderBg.scale.set(s);
			this.placeholderLabel.x = cx;
			this.placeholderLabel.y = height - size / 2;
			this.placeholderLabel.scale.set(s);
		}
	}
}

/**
 * Talking-head dialogue system — up to two portraits, one per screen
 * edge, each EDGE_MARGIN from the actual screen edge and overlaying
 * the strip. Text adapts to whichever side(s) are actually active:
 * sits opposite a single speaker, centers in the gap when both sides
 * are occupied. Tap anywhere on the strip to advance.
 * @author ShaAnder
 */
export class DialogueOverlay implements Overlay {
	readonly view = new Container();
	readonly blocksEscape = true;

	private strip = new Graphics();
	private leftSlot = new PortraitSlot("left");
	private rightSlot = new PortraitSlot("right");
	private nameText!: Text;
	private bodyText!: Text;
	private advanceCaret!: Text;
	private hitArea = new Graphics();

	private caretElapsedMs = 0;
	private advanceResolve: (() => void) | null = null;

	constructor(private game: Game) {
		this.view.addChild(this.strip);
		this.view.addChild(this.leftSlot.view);
		this.view.addChild(this.rightSlot.view);

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
				align: "left",
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
		this.leftSlot.active = false;
		this.rightSlot.active = false;
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

		const slot = line.side === "left" ? this.leftSlot : this.rightSlot;
		await slot.show(line);

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
		const gap = uiPx(TEXT_GAP, s);
		const stripY = height - stripH;

		this.strip.clear();
		this.strip.rect(0, stripY, width, stripH);
		this.strip.fill({ color: 0x0a0a0a, alpha: 0.92 });

		this.leftSlot.layout(width, height, s);
		this.rightSlot.layout(width, height, s);

		const leftActive = this.leftSlot.active;
		const rightActive = this.rightSlot.active;
		const leftW = this.leftSlot.width;
		const rightW = this.rightSlot.width;

		this.nameText.scale.set(s);
		this.bodyText.scale.set(s);

		if (leftActive && rightActive) {
			const textLeft = margin + leftW + gap;
			const textRight = width - margin - rightW - gap;
			const centerX = (textLeft + textRight) / 2;
			const wrapWidth = Math.max(120, (textRight - textLeft) / s);
			this.bodyText.style.align = "center";
			this.bodyText.style.wordWrapWidth = wrapWidth;
			this.bodyText.x = centerX - this.bodyText.width / 2;
			this.nameText.style.align = "center";
			this.nameText.x = centerX - this.nameText.width / 2;
		} else if (leftActive) {
			const textLeft = margin + leftW + gap;
			this.bodyText.style.align = "left";
			this.bodyText.style.wordWrapWidth = (width - margin - textLeft) / s;
			this.bodyText.x = textLeft;
			this.nameText.style.align = "left";
			this.nameText.x = textLeft;
		} else {
			const textRight = width - margin - rightW - gap;
			this.bodyText.style.align = "left";
			this.bodyText.style.wordWrapWidth = (textRight - margin) / s;
			this.bodyText.x = margin;
			this.nameText.style.align = "left";
			this.nameText.x = margin;
		}

		this.nameText.y = stripY + margin;
		this.bodyText.y = stripY + margin + uiPx(40, s);

		this.advanceCaret.x = width - margin - uiPx(10, s);
		this.advanceCaret.y = height - uiPx(16, s);
		this.advanceCaret.scale.set(s);

		this.hitArea.clear();
		this.hitArea.rect(0, stripY, width, stripH);
		this.hitArea.fill({ color: 0xffffff, alpha: 0.001 });
	}
}
