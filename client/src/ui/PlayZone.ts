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
const HOLD_MS = 500;
const FADE_MS = 220;

/**
 * Screen-centre drop strip for card plays.
 *
 * Wide grey zone with a "Play Cards" label; receives a dragged card,
 * snaps it into the exact visual centre of the zone, holds briefly,
 * then fades it out.
 *
 * "Skip Card »" below plays with no card.
 *
 * The zone itself is independently responsive: BattleOverlay supplies
 * the same UI scale used by the hand, so the zone and cards remain in
 * the same scaled coordinate system on mobile.
 *
 * @author ShaAnder
 */
export class PlayZone {
	readonly view = new Container();

	private zoneBg = new Graphics();
	private zoneLabel: Text;

	private noCardBtn = new Graphics();
	private noCardLabel: Text;

	private onNoCard: (() => void) | null = null;
	private noCardHitZone = new Graphics();

	constructor() {
		// ------------------------------------------------------------
		// Main play zone
		// ------------------------------------------------------------

		this.zoneBg.roundRect(
			-ZONE_WIDTH / 2,
			-ZONE_HEIGHT / 2,
			ZONE_WIDTH,
			ZONE_HEIGHT,
			16,
		);

		this.zoneBg.fill({
			color: 0x2a2a2a,
			alpha: 0.5,
		});

		this.zoneBg.stroke({
			width: 2,
			color: 0x777777,
			alpha: 0.65,
		});

		this.view.addChild(this.zoneBg);

		// ------------------------------------------------------------
		// Play Cards label
		// ------------------------------------------------------------

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

		// ------------------------------------------------------------
		// Skip button
		// ------------------------------------------------------------

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

		this.noCardBtn.roundRect(
			-SKIP_BTN_W / 2,
			-SKIP_BTN_H / 2,
			SKIP_BTN_W,
			SKIP_BTN_H,
			8,
		);

		this.noCardBtn.fill({
			color: 0x1a1a1a,
			alpha: 0.9,
		});

		this.noCardBtn.stroke({
			width: 1.5,
			color: 0x777777,
			alpha: 0.55,
		});

		this.noCardBtn.y = ZONE_HEIGHT / 2 + SKIP_GAP + SKIP_BTN_H / 2;

		// Visual button is deliberately non-interactive.
		// The separate hit zone underneath handles input.
		this.noCardBtn.eventMode = "none";

		this.view.addChild(this.noCardBtn);

		this.noCardLabel.y = this.noCardBtn.y;
		this.noCardLabel.eventMode = "none";

		this.view.addChild(this.noCardLabel);

		// ------------------------------------------------------------
		// Skip button hit zone
		// ------------------------------------------------------------

		this.noCardHitZone.rect(
			-SKIP_BTN_W / 2,
			-SKIP_BTN_H / 2,
			SKIP_BTN_W,
			SKIP_BTN_H,
		);

		this.noCardHitZone.fill({
			color: 0xffffff,
			alpha: 0.001,
		});

		this.noCardHitZone.y = this.noCardBtn.y;

		this.noCardHitZone.eventMode = "static";
		this.noCardHitZone.cursor = "pointer";

		this.noCardHitZone.on("pointerdown", () => this.onNoCard?.());

		// Added last so the hit zone is above the visual button.
		this.view.addChild(this.noCardHitZone);

		this.view.visible = false;
	}

	/**
	 * BattleOverlay ticks this every frame.
	 * Hold/fade use awaits, so no per-frame work is currently required.
	 */
	update(_deltaTime: number): void {
		// no-op
	}

	/**
	 * Registers the skip-button handler — set once by Hand.
	 */
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

	/**
	 * Positions and uniformly scales the PlayZone.
	 *
	 * x/y are in screen/global coordinates supplied by BattleOverlay.
	 * The same UI scale used by the hand can be passed here so that
	 * the zone and hand share the same responsive coordinate system.
	 */
	layout(x: number, y: number, s?: number): void {
		const scale = s ?? 1;

		this.view.scale.set(scale);
		this.view.x = x;
		this.view.y = y;
	}

	/**
	 * True if the global point is inside the grey play strip.
	 *
	 * The skip button is intentionally not included.
	 *
	 * getBounds() includes the PlayZone's current position and scale,
	 * which makes this work correctly when the responsive UI scale
	 * changes on smaller screens.
	 */
	containsGlobalPoint(globalX: number, globalY: number): boolean {
		const b = this.zoneBg.getBounds();

		return (
			globalX >= b.x &&
			globalX <= b.x + b.width &&
			globalY >= b.y &&
			globalY <= b.y + b.height
		);
	}

	/**
	 * Takes ownership of the dragged/selected card.
	 *
	 * The card is first converted from its current global position
	 * into PlayZone-local coordinates after reparenting. This preserves
	 * the visual starting position regardless of whether the card came
	 * from the responsive/scaled hand.
	 *
	 * The destination is then the TRUE visual centre of the PlayZone.
	 *
	 * Card pivot:
	 *   bottom-centre
	 *
	 * Therefore:
	 *   pivot Y = 0
	 *   card visual top = -CARD_HEIGHT
	 *   card visual bottom = 0
	 *   card visual centre = -CARD_HEIGHT / 2
	 *
	 * Because the PlayZone's origin is its centre, the correct final
	 * pivot position is therefore:
	 *
	 *   x = 0
	 *   y = -CARD_HEIGHT / 2
	 *
	 * This is the important correction for the previous offset.
	 *
	 * @param card - visual card token currently living on the stage/hand
	 * @param data - card data reserved for future overlay use
	 */
	async playCard(card: Card, data: CardData): Promise<void> {
		void data;

		// ------------------------------------------------------------
		// Preserve the card's current global position
		// ------------------------------------------------------------

		const globalPos = card.view.getGlobalPosition();

		/*
		 * Reparent the card into the PlayZone.
		 *
		 * Once reparented, x/y are relative to this.view rather than
		 * the hand/stage, so we convert the saved global position into
		 * PlayZone-local coordinates.
		 *
		 * This is what keeps the starting point correct when the hand
		 * has been uniformly scaled for mobile.
		 */
		card.view.removeFromParent();
		this.view.addChild(card.view);

		const localPos = this.view.toLocal(globalPos);

		card.view.x = localPos.x;
		card.view.y = localPos.y;

		// The card is now owned by the PlayZone, so use its normal scale.
		card.view.scale.set(1);
		card.view.alpha = 1;
		card.view.rotation = 0;

		this.zoneLabel.visible = false;

		// ------------------------------------------------------------
		// Exact visual centre
		// ------------------------------------------------------------

		const startX = card.view.x;
		const startY = card.view.y;

		/*
		 * IMPORTANT:
		 *
		 * Card pivot is bottom-centre.
		 *
		 * The PlayZone origin is its geometric centre.
		 *
		 * Therefore the card pivot needs to sit half a card-height
		 * ABOVE the PlayZone origin for the card itself to be centred.
		 */
		const endX = 0;
		const endY = CARD_HEIGHT / 2; // Pivot is bottom-center — for the card to straddle y=0 evenly (top at -H/2, bottom at +H/2), the pivot itself has to sit at +H/2, not -H/2. The negative sign here was the actual bug: it put the card's bottom edge above the zone's center instead of below it, so the whole card rendered in the zone's upper half.

		// ------------------------------------------------------------
		// Snap animation
		// ------------------------------------------------------------

		await this.tween(SNAP_MS, (t) => {
			const e = easeOutCubic(t);

			card.view.x = startX + (endX - startX) * e;

			card.view.y = startY + (endY - startY) * e;

			// Slight enlargement at the beginning of the slam,
			// settling to normal scale at the destination.
			card.view.scale.set(1 + 0.06 * (1 - e));
		});

		// Make the final position explicit so there is no floating-point
		// residue from the animation.
		card.view.x = endX;
		card.view.y = endY;
		card.view.scale.set(1);
		card.view.rotation = 0;

		// ------------------------------------------------------------
		// Hold
		// ------------------------------------------------------------

		await this.wait(HOLD_MS);

		// ------------------------------------------------------------
		// Fade out
		// ------------------------------------------------------------

		await this.tween(FADE_MS, (t) => {
			card.view.alpha = 1 - t;

			card.view.scale.set(1 - 0.15 * t);
		});

		// ------------------------------------------------------------
		// Cleanup
		// ------------------------------------------------------------

		card.view.removeFromParent();

		this.zoneLabel.visible = true;
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

				if (t < 1) {
					requestAnimationFrame(frame);
				} else {
					resolve();
				}
			};

			requestAnimationFrame(frame);
		});
	}

	/** Global center of the zone itself — used by tutorial UI pointers. */
	/**
	 * Global position of the zone's TOP edge, not its exact center —
	 * used by tutorial UI pointers. PlayZone always sits at screen
	 * center, and the player's own token can end up near there too
	 * depending on camera state — pointing at the exact midpoint risked
	 * visually coinciding with whatever else occupies that region.
	 * Targeting the top edge keeps real, deliberate separation.
	 */
	getZoneScreenPosition(): { x: number; y: number } {
		const center = this.view.getGlobalPosition();
		return { x: center.x, y: center.y - ZONE_HEIGHT / 2 };
	}

	/** Global position of the "No Card" / skip button — used by tutorial UI pointers. */
	getSkipButtonScreenPosition(): { x: number; y: number } {
		return this.noCardBtn.getGlobalPosition();
	}
}

function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - t, 3);
}
