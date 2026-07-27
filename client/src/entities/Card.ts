import { Container, Graphics, Text, ColorMatrixFilter } from "pixi.js";
import type { CardColor, CardData } from "@relic-hunter/shared";
import { isSpecialCard } from "@relic-hunter/shared";

export const CARD_WIDTH = 80;
export const CARD_HEIGHT = 110;

const CORNER_PAD = 6;
const CORNER_FONT = 16;

const FACE: Record<CardColor, number> = {
	blue: 0x4a9eff,
	red: 0xe74c3c,
	yellow: 0xf1c40f,
	green: 0x2ecc71,
	none: 0x888888,
};

/**
 * Visual card token — playing-card layout: value in opposite corners,
 * colour face, centre icon by action type. Position/layout are Hand's job.
 * @param data - card data (color, value, actionType)
 * @author ShaAnder
 */
export class Card {
	readonly view = new Container();

	private glow = new Graphics();
	private bg = new Graphics();
	private icon = new Graphics();
	private topLeft: Text;
	private bottomRight: Text;
	private data: CardData;

	private greyedOut = false;
	private highlighted = false;

	private static readonly grayscaleFilter = (() => {
		const f = new ColorMatrixFilter();
		f.desaturate();
		return f;
	})();

	constructor(data: CardData) {
		this.data = data;

		this.view.addChild(this.glow);
		this.view.addChild(this.bg);
		this.view.addChild(this.icon);

		const cornerStyle = {
			fill: 0xffffff,
			fontSize: CORNER_FONT,
			fontWeight: "bold" as const,
			fontFamily: "monospace",
		};

		this.topLeft = new Text({ text: "", style: cornerStyle });
		this.topLeft.anchor.set(0, 0);
		this.view.addChild(this.topLeft);

		this.bottomRight = new Text({ text: "", style: cornerStyle });
		this.bottomRight.anchor.set(0, 0);
		// Upside-down like a real playing card corner
		this.bottomRight.rotation = Math.PI;
		this.view.addChild(this.bottomRight);

		this.redraw();
	}

	getData(): CardData {
		return this.data;
	}

	/** Toggle click/hover. Doesn't affect visuals — see setGreyedOut. */
	setInteractive(interactive: boolean): void {
		this.view.eventMode = interactive ? "static" : "none";
	}

	/** True grayscale for cards that fail the active filter. */
	setGreyedOut(greyed: boolean): void {
		this.greyedOut = greyed;
		this.redraw();
	}

	/** Show/hide the highlight glow. */
	setHighlighted(highlighted: boolean): void {
		this.highlighted = highlighted;
		this.redraw();
	}

	/** Redraw face, corners, icon, glow. Never touches position. */
	private redraw(): void {
		const color = FACE[this.data.color];

		this.bg.clear();
		this.bg.roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 8);
		this.bg.fill(color);
		this.bg.stroke({ width: 3, color: 0xffffff });

		const label = this.cornerLabel();
		this.topLeft.text = label;
		this.topLeft.x = CORNER_PAD;
		this.topLeft.y = CORNER_PAD;

		this.bottomRight.text = label;
		// With rotation π and anchor 0,0, place so the glyph sits in the BR corner
		this.bottomRight.x = CARD_WIDTH - CORNER_PAD;
		this.bottomRight.y = CARD_HEIGHT - CORNER_PAD;

		this.icon.clear();
		this.drawIcon(this.icon);

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

	/** Numeric value, or A / C / E for specials. S for stun */
	private cornerLabel(): string {
		if (this.data.color === "none") return "—";
		if (this.data.actionType === "stun") return "S";
		if (isSpecialCard(this.data)) return this.data.value;
		return String(this.data.value);
	}

	/**
	 * Centre icon by action + special. All vector placeholders —
	 * swap for sprites later without touching layout.
	 */
	private drawIcon(g: Graphics): void {
		const cx = CARD_WIDTH / 2;
		const cy = CARD_HEIGHT / 2;
		const stroke = { width: 2.5, color: 0xffffff, alpha: 0.95 };

		const special = isSpecialCard(this.data) ? this.data.value : null;

		switch (this.data.actionType) {
			case "move":
				if (special === "E") this.drawPortal(g, cx, cy, stroke);
				else this.drawBoot(g, cx, cy, stroke);
				break;
			case "attack":
				if (special === "A") this.drawDoubleSword(g, cx, cy, stroke);
				else if (special === "C") this.drawCriticalSword(g, cx, cy, stroke);
				else this.drawSword(g, cx, cy, stroke);
				break;
			case "defense":
				if (special === "A") this.drawNullifyShield(g, cx, cy, stroke);
				else if (special === "C") this.drawDoubleShield(g, cx, cy, stroke);
				else this.drawShield(g, cx, cy, stroke);
				break;
			case "stun":
				this.drawTrap(g, cx, cy, stroke);
				break;
			default:
				this.drawPlaceholder(g, cx, cy, stroke);
		}
	}

	// ----- icon placeholders -----

	private drawBoot(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		// Simple side-view boot silhouette
		g.moveTo(cx - 10, cy + 10);
		g.lineTo(cx - 10, cy - 2);
		g.lineTo(cx - 2, cy - 10);
		g.lineTo(cx + 6, cy - 10);
		g.lineTo(cx + 6, cy + 2);
		g.lineTo(cx + 12, cy + 2);
		g.lineTo(cx + 12, cy + 10);
		g.closePath();
		g.stroke(stroke);
	}

	private drawPortal(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		// Nested ellipses — reads as a portal / exit gate
		g.ellipse(cx, cy, 14, 18);
		g.stroke(stroke);
		g.ellipse(cx, cy, 8, 12);
		g.stroke({ ...stroke, width: 2 });
		g.moveTo(cx, cy - 12);
		g.lineTo(cx, cy + 12);
		g.stroke({ ...stroke, width: 1.5, alpha: 0.7 });
	}

	private drawSword(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		// Blade up, crossguard, pommel
		g.moveTo(cx, cy - 16);
		g.lineTo(cx, cy + 8);
		g.stroke(stroke);
		g.moveTo(cx - 8, cy + 2);
		g.lineTo(cx + 8, cy + 2);
		g.stroke(stroke);
		g.circle(cx, cy + 12, 3);
		g.stroke(stroke);
	}

	private drawDoubleSword(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		// Two crossed blades — Double Dmg (A)
		g.moveTo(cx - 8, cy - 14);
		g.lineTo(cx + 8, cy + 10);
		g.stroke(stroke);
		g.moveTo(cx + 8, cy - 14);
		g.lineTo(cx - 8, cy + 10);
		g.stroke(stroke);
		g.moveTo(cx - 10, cy + 2);
		g.lineTo(cx + 10, cy + 2);
		g.stroke({ ...stroke, width: 2 });
	}

	private drawCriticalSword(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		this.drawSword(g, cx, cy, stroke);
		// Starburst / impact around the tip
		const rays = 6;
		for (let i = 0; i < rays; i++) {
			const a = (i / rays) * Math.PI * 2;
			g.moveTo(cx + Math.cos(a) * 6, cy - 12 + Math.sin(a) * 6);
			g.lineTo(cx + Math.cos(a) * 12, cy - 12 + Math.sin(a) * 12);
		}
		g.stroke({ ...stroke, width: 1.5, alpha: 0.85 });
	}

	private drawShield(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		g.moveTo(cx - 12, cy - 8);
		g.lineTo(cx + 12, cy - 8);
		g.lineTo(cx + 12, cy + 2);
		g.lineTo(cx, cy + 14);
		g.lineTo(cx - 12, cy + 2);
		g.closePath();
		g.stroke(stroke);
	}

	private drawDoubleShield(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		// Outer + inner shield outline — Double Def (C)
		this.drawShield(g, cx, cy, stroke);
		g.moveTo(cx - 7, cy - 4);
		g.lineTo(cx + 7, cy - 4);
		g.lineTo(cx + 7, cy + 2);
		g.lineTo(cx, cy + 9);
		g.lineTo(cx - 7, cy + 2);
		g.closePath();
		g.stroke({ ...stroke, width: 1.5 });
	}

	private drawNullifyShield(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		this.drawShield(g, cx, cy, stroke);
		// Slash through — Nullify (A)
		g.moveTo(cx - 14, cy + 12);
		g.lineTo(cx + 14, cy - 12);
		g.stroke({ ...stroke, width: 3 });
	}

	private drawTrap(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		// Hex plate + centre dot — stun / trap placeholder
		for (let i = 0; i < 6; i++) {
			const a0 = (i / 6) * Math.PI * 2 - Math.PI / 2;
			const a1 = ((i + 1) / 6) * Math.PI * 2 - Math.PI / 2;
			const r = 14;
			if (i === 0) g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
			g.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
		}
		g.closePath();
		g.stroke(stroke);
		g.circle(cx, cy, 4);
		g.stroke(stroke);
	}

	private drawPlaceholder(
		g: Graphics,
		cx: number,
		cy: number,
		stroke: { width: number; color: number; alpha: number },
	): void {
		g.circle(cx, cy, 10);
		g.stroke(stroke);
	}
}
