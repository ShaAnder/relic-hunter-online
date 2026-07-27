import { Container, Graphics, Text } from "pixi.js";
import { Card, CARD_WIDTH, CARD_HEIGHT } from "@/entities/Card";
import type { CardData } from "@relic-hunter/shared";

const ZONE_PADDING = 10;
const ZONE_WIDTH = CARD_WIDTH + ZONE_PADDING * 2;
const ZONE_HEIGHT = CARD_HEIGHT + ZONE_PADDING * 2;
const NO_CARD_BTN_HEIGHT = 32;
const NO_CARD_BTN_GAP = 10;

const SLAM_GROW_MS = 120;
const SLAM_IMPACT_MS = 90;
const SLAM_VANISH_MS = 140;
const SLAM_SCALE = 1.35;
const OVERLAY_DURATION_MS = 1500;

/**
 * The "play a card" moment, sized to match a real card. Only visible
 * while a play decision is active — Hand calls show()/hide() around its
 * own enter/exitSelectionMode, not a real Overlay (that would block the
 * drag itself). Also owns the "No Card" button, directly below the zone.
 * @author ShaAnder
 */
export class PlayZone {
	readonly view = new Container();

	private zoneBg = new Graphics();
	private zoneLabel: Text;
	private noCardBtn = new Graphics();
	private noCardLabel: Text;
	private overlayBg = new Graphics();
	private overlayText: Text;
	private overlayTimerMs = 0;

	private onNoCard: (() => void) | null = null;

	constructor() {
		this.zoneBg.roundRect(
			-ZONE_WIDTH / 2,
			-ZONE_HEIGHT / 2,
			ZONE_WIDTH,
			ZONE_HEIGHT,
			12,
		);
		this.zoneBg.fill({ color: 0xffffff, alpha: 0.06 });
		this.zoneBg.stroke({ width: 2, color: 0xffd700, alpha: 0.5 });
		this.view.addChild(this.zoneBg);

		this.zoneLabel = new Text({
			text: "Play",
			style: { fill: 0xffffff, fontSize: 13, fontWeight: "bold" },
		});
		this.zoneLabel.anchor.set(0.5);
		this.zoneLabel.alpha = 0.5;
		this.view.addChild(this.zoneLabel);

		this.noCardBtn.roundRect(
			-ZONE_WIDTH / 2,
			ZONE_HEIGHT / 2 + NO_CARD_BTN_GAP,
			ZONE_WIDTH,
			NO_CARD_BTN_HEIGHT,
			6,
		);
		this.noCardBtn.fill(0x2a2a2a);
		this.noCardBtn.stroke({ width: 1, color: 0x666666 });
		this.noCardBtn.eventMode = "static";
		this.noCardBtn.cursor = "pointer";
		this.noCardBtn.on("pointerdown", () => this.onNoCard?.());
		this.view.addChild(this.noCardBtn);

		this.noCardLabel = new Text({
			text: "No Card",
			style: { fill: 0xcccccc, fontSize: 12 },
		});
		this.noCardLabel.anchor.set(0.5);
		this.noCardLabel.x = 0;
		this.noCardLabel.y =
			ZONE_HEIGHT / 2 + NO_CARD_BTN_GAP + NO_CARD_BTN_HEIGHT / 2;
		this.view.addChild(this.noCardLabel);

		this.overlayText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 13, align: "center" },
		});
		this.overlayText.anchor.set(0.5, 1);
		this.overlayText.y = -ZONE_HEIGHT / 2 - 16;
		this.view.addChild(this.overlayBg);
		this.view.addChild(this.overlayText);
		this.overlayBg.visible = false;
		this.overlayText.visible = false;

		this.view.visible = false;
	}

	/** Registers what fires when "No Card" is clicked — set once by whoever owns this zone. */
	setNoCardHandler(handler: () => void): void {
		this.onNoCard = handler;
	}

	show(): void {
		this.view.visible = true;
	}

	hide(): void {
		this.view.visible = false;
	}

	/** Centers the zone on screen (or wherever the caller wants it, per context). */
	layout(x: number, y: number): void {
		this.view.x = x;
		this.view.y = y;
	}

	/** True if the given GLOBAL (screen) point is inside the card-drop area (not the No Card button). */
	containsGlobalPoint(globalX: number, globalY: number): boolean {
		const local = this.view.toLocal({ x: globalX, y: globalY });
		return (
			Math.abs(local.x) <= ZONE_WIDTH / 2 &&
			Math.abs(local.y) <= ZONE_HEIGHT / 2
		);
	}

	update(deltaTime: number): void {
		const deltaMs = (deltaTime / 60) * 1000;
		if (this.overlayTimerMs > 0) {
			this.overlayTimerMs -= deltaMs;
			if (this.overlayTimerMs <= 0) {
				this.overlayBg.visible = false;
				this.overlayText.visible = false;
			}
		}
	}

	/**
	 * Takes ownership of `card`'s view: re-parents it here at its current
	 * screen position (no visual jump), then runs grow → slam → vanish.
	 * Resolves once vanished — caller still owns removing the card from
	 * real hand data.
	 */
	async playCard(card: Card, data: CardData): Promise<void> {
		this.showOverlay(data);

		const globalPos = card.view.getGlobalPosition();
		card.view.removeFromParent();
		this.view.addChild(card.view);
		const localPos = this.view.toLocal(globalPos);
		card.view.x = localPos.x;
		card.view.y = localPos.y;

		const startX = localPos.x;
		const startY = localPos.y;

		await this.tween(SLAM_GROW_MS, (t) => {
			card.view.scale.set(1 + (SLAM_SCALE - 1) * t);
		});

		await this.tween(SLAM_IMPACT_MS, (t) => {
			card.view.x = startX * (1 - t);
			card.view.y = startY * (1 - t) - CARD_HEIGHT * 0.1 * (1 - t);
		});

		await this.tween(SLAM_VANISH_MS, (t) => {
			card.view.alpha = 1 - t;
			card.view.scale.set(SLAM_SCALE * (1 - t * 0.3));
		});

		card.view.removeFromParent();
	}

	private showOverlay(data: CardData): void {
		this.overlayText.text = `${data.name}\n${data.description}`;
		this.overlayText.visible = true;

		const bounds = this.overlayText.getLocalBounds();
		this.overlayBg.clear();
		this.overlayBg.roundRect(
			this.overlayText.x - bounds.width / 2 - 10,
			this.overlayText.y - bounds.height - 6,
			bounds.width + 20,
			bounds.height + 12,
			6,
		);
		this.overlayBg.fill({ color: 0x000000, alpha: 0.75 });
		this.overlayBg.visible = true;

		this.overlayTimerMs = OVERLAY_DURATION_MS;
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
