import { Container, Graphics, Text } from "pixi.js";
import type { TurnManager } from "@/systems/TurnManager";

const MAX_HAND_SIZE = 5;

/**
 * Compact deck/hand readout — "Deck: 61  Hand: 3/5" — so the player can
 * see the ONE SHARED match deck shrinking (every hunter on the map draws
 * from it, not just them) and knows how close it is to exhaustion (see
 * `04-card-system-design.md` §Hand Economy for what happens then). Reads
 * TurnManager's deckRemaining/handSize getters; call sync() whenever
 * TurnManager fires its onChanged callback, same as ButtonBar already does.
 */
export class DeckTracker {
	readonly view = new Container();

	private bg = new Graphics();
	private text: Text;

	constructor() {
		this.bg.roundRect(0, 0, 160, 40, 8);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.85 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		this.text = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 13, fontFamily: "monospace" },
		});
		this.text.x = 12;
		this.text.y = 11;
		this.view.addChild(this.text);
	}

	/** Refresh the readout from the current TurnManager state. */
	sync(turnManager: TurnManager): void {
		// Threshold scaled for the 75-card shared deck (was calibrated for
		// a 20-card personal deck before that model changed).
		const deckLow = turnManager.deckRemaining <= 15;
		this.text.style.fill = deckLow ? 0xff6b6b : 0xffffff;
		this.text.text = `Deck: ${turnManager.deckRemaining}   Hand: ${turnManager.handSize}/${MAX_HAND_SIZE}`;
	}

	/** Position the tracker — call from the owning scene's layout logic. */
	layout(x: number, y: number): void {
		this.view.x = x;
		this.view.y = y;
	}
}
