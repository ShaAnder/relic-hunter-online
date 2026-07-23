import { Container, Graphics, Text, ColorMatrixFilter } from "pixi.js";
import type { CardColor, CardData } from "@relic-hunter/shared";

export const CARD_WIDTH = 80;
export const CARD_HEIGHT = 110;

/**
 * Visual card token shown in the player's hand.
 * Owns only disabled/highlighted rendering — position and layout are Hand's job.
 * @param data - the card's data (color, value, etc.)
 * @author ShaAnder
 */
export class Card {
	readonly view = new Container();

	private glow = new Graphics();
	private bg = new Graphics();
	private label: Text;
	private data: CardData;

	private greyedOut = false;
	private highlighted = false;

	// Shared filter instance — fixed matrix, no per-card state
	private static readonly grayscaleFilter = (() => {
		const f = new ColorMatrixFilter();
		f.desaturate();
		return f;
	})();

	constructor(data: CardData) {
		this.data = data;

		this.view.addChild(this.glow);
		this.view.addChild(this.bg);

		this.label = new Text({
			text: data.name,
			style: {
				fill: 0xffffff,
				fontSize: 14,
				fontWeight: "bold",
				align: "center",
			},
		});
		this.label.anchor.set(0.5);
		this.view.addChild(this.label);

		this.redraw();
	}

	getData(): CardData {
		return this.data;
	}

	/** Toggle click/hover. Doesn't affect visuals — see setGreyedOut for that. */
	setInteractive(interactive: boolean): void {
		this.view.eventMode = interactive ? "static" : "none";
	}

	/** True grayscale, always opaque — for a card that fails the active filter. */
	setGreyedOut(greyed: boolean): void {
		this.greyedOut = greyed;
		this.redraw();
	}

	/** Show/hide the highlight glow. */
	setHighlighted(highlighted: boolean): void {
		this.highlighted = highlighted;
		this.redraw();
	}

	/** Redraw body/label/glow for current state. Never touches position. */
	private redraw(): void {
		const colors: Record<CardColor, number> = {
			blue: 0x4a9eff,
			red: 0xe74c3c,
			yellow: 0xf1c40f,
			green: 0x2ecc71,
			none: 0x888888,
		};

		this.bg.clear();
		this.bg.roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 8);
		this.bg.fill(colors[this.data.color]);
		this.bg.stroke({ width: 3, color: 0xffffff });

		this.label.text = this.data.name;
		this.label.x = CARD_WIDTH / 2;
		this.label.y = CARD_HEIGHT / 2;

		// Always fully opaque, never transparent
		this.view.alpha = 1;

		if (this.greyedOut) {
			this.view.filters = [Card.grayscaleFilter];
			this.glow.clear();
			return;
		}

		this.view.filters = [];

		this.glow.clear();
		if (this.highlighted) {
			this.glow.roundRect(-6, -6, CARD_WIDTH + 12, CARD_HEIGHT + 12, 12);
			this.glow.fill({ color: 0xffffff, alpha: 0.25 });
		}
	}
}
