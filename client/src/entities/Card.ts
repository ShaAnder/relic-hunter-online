import { Container, Graphics, Text, ColorMatrixFilter } from "pixi.js";

export type CardColor = "blue" | "red" | "yellow" | "green" | "none";

/** Special card markers — see `04-card-system-design.md` for exact effects per color. */
export type CardSpecial = "A" | "C" | "E";

/* Set containing special cards */
const CARD_SPECIALS = new Set<CardSpecial>(["A", "C", "E"]);

/* Card Data Interface, we take the above special or a number for our types */
export interface CardData {
	id: string;
	color: CardColor;
	name: string;
	value: number | CardSpecial;
	description: string;
	actionType: "move" | "attack" | "defense" | "stun";
}

/** True if this card is a special (A/C/E, or any future addition) rather than a plain numeric value. */
export function isSpecialCard(
	data: CardData,
): data is CardData & { value: CardSpecial } {
	return CARD_SPECIALS.has(data.value as CardSpecial);
}

export const CARD_WIDTH = 80;
export const CARD_HEIGHT = 110;

/**
 * Visual card token shown in the player's hand.
 *
 * Purely a rendering component — disabled (true grayscale via a color
 * matrix filter, always fully opaque) and highlighted (glow behind the
 * card) are the only states Card owns. Position, rotation, and lift are
 * entirely Hand's responsibility, so multiple layout systems never fight
 * over the same transform.
 */
export class Card {
	readonly view = new Container();

	private glow = new Graphics();
	private bg = new Graphics();
	private label: Text;
	private data: CardData;

	private greyedOut = false;
	private highlighted = false;

	// Shared single instance — desaturate() is a fixed matrix, no per-card state
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

	/**
	 * Toggle click/hover interactivity. Purely functional — never changes
	 * how the card looks. Cards are non-interactive at rest (Move not
	 * pressed) but still shown in full color; see setGreyedOut for the
	 * visual half of "can't be played right now."
	 */
	setInteractive(interactive: boolean): void {
		this.view.eventMode = interactive ? "static" : "none";
	}

	/**
	 * True grayscale (always opaque, never faded) for a card that fails the
	 * active selection filter. Independent of interactivity — a card can be
	 * full color and non-interactive (resting) or gray and non-interactive
	 * (ineligible during selection), but never gray while still clickable.
	 */
	setGreyedOut(greyed: boolean): void {
		this.greyedOut = greyed;
		this.redraw();
	}

	/** Show/hide the glow — used when the selection caret rests on this card. */
	setHighlighted(highlighted: boolean): void {
		this.highlighted = highlighted;
		this.redraw();
	}

	/** Redraw body, label, and glow for the current state. Never touches position. */
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

		// Always fully opaque — solid, never transparent, in either state
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
