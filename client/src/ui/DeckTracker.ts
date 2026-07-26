import { Container, Graphics, Text } from "pixi.js";
import type { TurnManager } from "@/systems/TurnManager";

/**
 * Top-right deck icon + remaining count. Hand size removed —
 * the fan Hand UI is the source of truth for cards held.
 * @author ShaAnder
 */
export class DeckTracker {
	readonly view = new Container();

	private bg = new Graphics();
	private icon = new Graphics();
	private text: Text;

	constructor() {
		this.bg.roundRect(0, 0, 88, 40, 8);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.85 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		// Simple card-back icon
		this.icon.roundRect(8, 8, 18, 24, 2);
		this.icon.fill(0x2a4a7a);
		this.icon.stroke({ width: 1, color: 0x88aaff });
		this.view.addChild(this.icon);

		this.text = new Text({
			text: "75",
			style: {
				fill: 0xffffff,
				fontSize: 16,
				fontWeight: "bold",
				fontFamily: "monospace",
			},
		});
		this.text.x = 32;
		this.text.y = 10;
		this.view.addChild(this.text);
	}

	sync(turnManager: TurnManager): void {
		const remaining = turnManager.deckRemaining;
		this.text.style.fill = remaining <= 15 ? 0xff6b6b : 0xffffff;
		this.text.text = String(remaining);
	}

	layout(screenWidth: number): void {
		this.view.x = screenWidth - 104;
		this.view.y = 12;
	}
}
