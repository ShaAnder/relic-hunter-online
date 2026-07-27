import { Container, Graphics, Text } from "pixi.js";
import { Card, CARD_WIDTH, CARD_HEIGHT } from "@/entities/Card";
import type { CardData } from "@relic-hunter/shared";

// Wide drop strip — ~4× a single card, slightly taller
const ZONE_WIDTH = CARD_WIDTH * 4 + 48;
const ZONE_HEIGHT = CARD_HEIGHT + 56;
const SKIP_BTN_W = 120;
const SKIP_BTN_H = 32;
const SKIP_GAP = 14;

const SNAP_MS = 140;
const HOLD_MS = 1000;
const FADE_MS = 220;

/**
 * Screen-centre drop strip for card plays. Wide grey zone with a
 * "Play Cards" label; receives a dragged card, snaps it into place,
 * holds briefly, then fades it out. "Skip Card »" below plays with no card.
 * @author ShaAnder
 */
export class PlayZone {
	readonly view = new Container();

	private zoneBg = new Graphics();
	private zoneLabel: Text;
	private noCardBtn = new Graphics();
	private noCardLabel: Text;

	private onNoCard: (() => void) | null = null;

	constructor() {
		this.zoneBg.roundRect(
			-ZONE_WIDTH / 2,
			-ZONE_HEIGHT / 2,
			ZONE_WIDTH,
			ZONE_HEIGHT,
			16,
		);
		this.zoneBg.fill({ color: 0x2a2a2a, alpha: 0.5 });
		this.zoneBg.stroke({ width: 2, color: 0x777777, alpha: 0.65 });
		this.view.addChild(this.zoneBg);

		this.zoneLabel = new Text({
			text: "Play Cards",
			style: {
				fill: 0xbbbbbb,
				fontSize: 20,
				fontWeight: "bold",
				letterSpacing: 1.5,
			},
		});
		this.zoneLabel.anchor.set(0.5);
		this.zoneLabel.alpha = 0.5;
		this.view.addChild(this.zoneLabel);

		this.noCardLabel = new Text({
			text: "Skip Card  »",
			style: {
				fill: 0xcccccc,
				fontSize: 13,
				fontWeight: "bold",
				letterSpacing: 0.5,
			},
		});
		this.noCardLabel.anchor.set(0.5);

		this.drawSkipButton(false);
		this.noCardBtn.y = ZONE_HEIGHT / 2 + SKIP_GAP + SKIP_BTN_H / 2;
		this.noCardLabel.y = this.noCardBtn.y;

		this.noCardBtn.eventMode = "static";
		this.noCardBtn.cursor = "pointer";
		this.noCardBtn.on("pointerdown", () => this.onNoCard?.());
		this.noCardBtn.on("pointerover", () => this.drawSkipButton(true));
		this.noCardBtn.on("pointerout", () => this.drawSkipButton(false));

		this.view.addChild(this.noCardBtn);
		this.view.addChild(this.noCardLabel);

		this.view.visible = false;
	}

	/** BattleOverlay ticks this every frame. Hold/fade use awaits, so no work here yet. */
	update(_deltaTime: number): void {
		// no-op
	}

	/** Registers the skip-button handler — set once by Hand. */
	setNoCardHandler(handler: () => void): void {
		this.onNoCard = handler;
	}

	show(): void {
		this.view.visible = true;
		this.zoneLabel.visible = true;
	}

	hide(): void {
		this.view.visible = false;
	}

	/** Centre of the screen (or any caller-chosen point). */
	layout(x: number, y: number): void {
		this.view.x = x;
		this.view.y = y;
	}

	/** True if the global point is inside the grey strip (not the skip button). */
	containsGlobalPoint(globalX: number, globalY: number): boolean {
		const local = this.view.toLocal({ x: globalX, y: globalY });
		return (
			Math.abs(local.x) <= ZONE_WIDTH / 2 &&
			Math.abs(local.y) <= ZONE_HEIGHT / 2
		);
	}

	/**
	 * Takes ownership of the dragged card, snaps it to zone centre,
	 * holds for a beat, then fades it out.
	 * @param card - visual card token still living on the stage
	 * @param data - card data (reserved for future overlay use)
	 */
	async playCard(card: Card, data: CardData): Promise<void> {
		void data;

		const globalPos = card.view.getGlobalPosition();
		card.view.removeFromParent();
		this.view.addChild(card.view);

		const localPos = this.view.toLocal(globalPos);
		card.view.x = localPos.x;
		card.view.y = localPos.y;
		card.view.scale.set(1);
		card.view.alpha = 1;
		card.view.rotation = 0;

		this.zoneLabel.visible = false;

		const startX = card.view.x;
		const startY = card.view.y;
		// Pivot is bottom-centre — offset so the card sits visually centred
		const endX = 0;
		const endY = CARD_HEIGHT / 2;

		await this.tween(SNAP_MS, (t) => {
			const e = easeOutCubic(t);
			card.view.x = startX + (endX - startX) * e;
			card.view.y = startY + (endY - startY) * e;
			card.view.scale.set(1 + 0.06 * (1 - e));
		});

		card.view.x = endX;
		card.view.y = endY;
		card.view.scale.set(1);

		await this.wait(HOLD_MS);

		await this.tween(FADE_MS, (t) => {
			card.view.alpha = 1 - t;
			card.view.scale.set(1 - 0.15 * t);
		});

		card.view.removeFromParent();
		this.zoneLabel.visible = true;
	}

	/** Pill button. Hover brightens fill, stroke, and label. */
	private drawSkipButton(hovered: boolean): void {
		this.noCardBtn.clear();
		this.noCardBtn.roundRect(
			-SKIP_BTN_W / 2,
			-SKIP_BTN_H / 2,
			SKIP_BTN_W,
			SKIP_BTN_H,
			8,
		);
		this.noCardBtn.fill({ color: hovered ? 0x333333 : 0x1a1a1a, alpha: 0.9 });
		this.noCardBtn.stroke({
			width: 1.5,
			color: hovered ? 0xffffff : 0x777777,
			alpha: hovered ? 0.85 : 0.55,
		});
		this.noCardLabel.style.fill = hovered ? 0xffffff : 0xcccccc;
	}

	private wait(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private tween(ms: number, onStep: (t: number) => void): Promise<void> {
		return new Promise((resolve) => {
			const start = performance.now();
			const frame = (): void => {
				const t = Math.min(1, (performance.now() - start) / ms);
				onStep(t);
				if (t < 1) requestAnimationFrame(frame);
				else resolve();
			};
			requestAnimationFrame(frame);
		});
	}
}

function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - t, 3);
}
