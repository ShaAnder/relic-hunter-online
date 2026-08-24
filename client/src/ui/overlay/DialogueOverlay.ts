import { Container, Graphics, Text } from "pixi.js";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import { computeUiScale, uiPx } from "@/math/uiScale";
import type { DialogueLine } from "@/tutorial/dialogue";

const STRIP_HEIGHT = 150;
const PORTRAIT_SIZE = 110;
const MARGIN = 20;
const ADVANCE_CARET_PULSE_SPEED = 0.005;

const PLACEHOLDER_COLORS: Record<string, number> = {
	narrator: 0x4a9eff,
	default: 0x888888,
};

function colorForPortrait(portraitId: string): number {
	return PLACEHOLDER_COLORS[portraitId] ?? PLACEHOLDER_COLORS.default;
}

/**
 * Bottom-strip narrator/dialogue system — a portrait, a speaker name,
 * and word-wrapped text, tap-anywhere-on-the-strip to advance. Never
 * covers the full screen. Deliberately generic: tutorials, the
 * eventual shop, and story mode all drive this same overlay with the
 * same DialogueLine shape.
 * @author ShaAnder
 */
export class DialogueOverlay implements Overlay {
	readonly view = new Container();
	readonly blocksEscape = true;

	private strip = new Graphics();
	private portraitBg = new Graphics();
	private portraitLabel!: Text;
	private nameText!: Text;
	private bodyText!: Text;
	private advanceCaret!: Text;
	private hitArea = new Graphics();

	private caretElapsedMs = 0;
	private advanceResolve: (() => void) | null = null;

	constructor(private game: Game) {
		this.view.addChild(this.strip);
		this.view.addChild(this.portraitBg);

		this.portraitLabel = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 48, fontWeight: "bold" },
		});
		this.portraitLabel.anchor.set(0.5);
		this.view.addChild(this.portraitLabel);

		this.nameText = new Text({
			text: "",
			style: { fill: 0xffd700, fontSize: 18, fontWeight: "bold" },
		});
		this.view.addChild(this.nameText);

		this.bodyText = new Text({
			text: "",
			style: {
				fill: 0xffffff,
				fontSize: 16,
				wordWrap: true,
				wordWrapWidth: 600,
				lineHeight: 22,
			},
		});
		this.view.addChild(this.bodyText);

		this.advanceCaret = new Text({
			text: "▼",
			style: { fill: 0xaaaaaa, fontSize: 16 },
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
			this.showLine(line);
			await this.waitForAdvance();
		}
	}

	private showLine(line: DialogueLine): void {
		this.nameText.text = line.speaker;
		this.bodyText.text = line.text;
		this.portraitLabel.text = line.speaker.charAt(0).toUpperCase();
		this.portraitBg.clear();
		this.portraitBg.roundRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE, 8);
		this.portraitBg.fill(colorForPortrait(line.portraitId));
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
		const portraitSize = uiPx(PORTRAIT_SIZE, s);
		const margin = uiPx(MARGIN, s);
		const stripY = height - stripH;

		this.strip.clear();
		this.strip.rect(0, stripY, width, stripH);
		this.strip.fill({ color: 0x0a0a0a, alpha: 0.92 });

		this.portraitBg.x = margin;
		this.portraitBg.y = stripY + (stripH - portraitSize) / 2;
		this.portraitBg.scale.set(s);

		this.portraitLabel.x = margin + portraitSize / 2;
		this.portraitLabel.y = stripY + stripH / 2;
		this.portraitLabel.scale.set(s);

		const textX = margin + portraitSize + margin;
		this.nameText.x = textX;
		this.nameText.y = stripY + margin;
		this.nameText.scale.set(s);

		this.bodyText.x = textX;
		this.bodyText.y = stripY + margin + uiPx(30, s);
		this.bodyText.scale.set(s);
		this.bodyText.style.wordWrapWidth = (width - textX - margin * 2) / s;

		this.advanceCaret.x = width - margin - uiPx(10, s);
		this.advanceCaret.y = height - uiPx(16, s);
		this.advanceCaret.scale.set(s);

		this.hitArea.clear();
		this.hitArea.rect(0, stripY, width, stripH);
		this.hitArea.fill({ color: 0xffffff, alpha: 0.001 });
	}
}
