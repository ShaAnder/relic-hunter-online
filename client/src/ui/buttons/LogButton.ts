import { Container, Graphics } from "pixi.js";

/**
 * Clickable log icon that toggles LogPanel.
 * Sits directly right of BagButton.
 * @author ShaAnder
 */
export class LogsButton {
	readonly view = new Container();
	private bg = new Graphics();
	private icon = new Graphics();

	constructor() {
		this.bg.roundRect(0, 0, 40, 40, 6);
		this.bg.fill(0x2a2a2a);
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		// Simple scroll/list silhouette — three horizontal lines
		this.icon.moveTo(10, 14);
		this.icon.lineTo(30, 14);
		this.icon.moveTo(10, 20);
		this.icon.lineTo(30, 20);
		this.icon.moveTo(10, 26);
		this.icon.lineTo(24, 26);
		this.icon.stroke({ width: 2, color: 0xcccccc });
		this.view.addChild(this.icon);

		this.view.eventMode = "static";
		this.view.cursor = "pointer";
	}

	/** Directly right of the bag icon, matching its own y so both sit in one row. */
	layout(bagX: number, bagY: number): void {
		this.view.x = bagX + 40 + 8;
		this.view.y = bagY;
	}

	hitTest(screenX: number, screenY: number): boolean {
		const lx = screenX - this.view.x;
		const ly = screenY - this.view.y;
		return lx >= 0 && lx <= 40 && ly >= 0 && ly <= 40;
	}
}
