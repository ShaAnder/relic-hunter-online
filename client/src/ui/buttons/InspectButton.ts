import { Container, Graphics } from "pixi.js";

/**
 * Clickable magnifying-glass icon that toggles the hunter summary panel.
 * Same size/pattern as LogsButton — sits alongside it in the button row.
 * @author ShaAnder
 */
export class InspectButton {
	readonly view = new Container();
	private bg = new Graphics();
	private icon = new Graphics();

	constructor() {
		this.bg.roundRect(0, 0, 40, 40, 6);
		this.bg.fill(0x2a2a2a);
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		// Magnifying glass — circle + handle
		this.icon.circle(17, 17, 8);
		this.icon.stroke({ width: 2, color: 0xcccccc });
		this.icon.moveTo(23, 23);
		this.icon.lineTo(30, 30);
		this.icon.stroke({ width: 2, color: 0xcccccc });
		this.view.addChild(this.icon);

		this.view.eventMode = "static";
		this.view.cursor = "pointer";
	}

	/** Directly right of whichever button it's anchored to (matches LogsButton's own layout signature). */
	layout(anchorX: number, anchorY: number): void {
		this.view.x = anchorX + 40 + 8;
		this.view.y = anchorY;
	}

	hitTest(screenX: number, screenY: number): boolean {
		const lx = screenX - this.view.x;
		const ly = screenY - this.view.y;
		return lx >= 0 && lx <= 40 && ly >= 0 && ly <= 40;
	}
}
