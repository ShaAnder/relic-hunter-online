import { Container, Graphics, Text } from "pixi.js";
import { Card, CARD_HEIGHT } from "@/entities/Card";
import type { CardData } from "@relic-hunter/shared";

const ZONE_WIDTH = 160;
const ZONE_HEIGHT = 120;
const RESTING_SCALE = 0.65; // matches Hand's own card scale — kept in sync manually for now

const SLAM_GROW_MS = 120;
const SLAM_IMPACT_MS = 90;
const SLAM_VANISH_MS = 140;
const SLAM_SCALE = 1.35;
const OVERLAY_DURATION_MS = 1500;

/**
 * Independent center-screen entity that owns the "play a card" moment.
 * Anything holding a Card instance can hand it off here — it re-parents
 * the card (preserving its current screen position, no visual jump),
 * runs grow → slam-to-center → vanish, then releases it. Decoupled from
 * Hand entirely; Hand is just one caller among possibly several later.
 * @author ShaAnder
 */
export class PlayZone {
	readonly view = new Container();

	private zoneBg = new Graphics();
	private zoneLabel: Text;
	private overlayBg = new Graphics();
	private overlayText: Text;
	private overlayTimerMs = 0;

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
	}

	/** Centers the zone on screen. */
	layout(screenWidth: number, screenHeight: number): void {
		this.view.x = screenWidth / 2;
		this.view.y = screenHeight / 2;
	}

	/** True if the given GLOBAL (screen) point is inside the zone's bounds. */
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
	 * real hand data, this only handles the visual moment.
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
			const s = RESTING_SCALE + (SLAM_SCALE - RESTING_SCALE) * t;
			card.view.scale.set(s);
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
