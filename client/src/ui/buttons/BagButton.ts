import { Container, Graphics } from "pixi.js";

/**
 * Clickable bag icon that toggles InventoryPanel.
 * Sits directly below CharacterPanel.
 * @author ShaAnder
 */
export class BagButton {
	readonly view = new Container();
	private bg = new Graphics();
	private icon = new Graphics();

	constructor() {
		this.bg.roundRect(0, 0, 40, 40, 6);
		this.bg.fill(0x2a2a2a);
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		// Simple bag silhouette
		this.icon.moveTo(10, 14);
		this.icon.lineTo(10, 32);
		this.icon.lineTo(30, 32);
		this.icon.lineTo(30, 14);
		this.icon.lineTo(24, 10);
		this.icon.lineTo(16, 10);
		this.icon.closePath();
		this.icon.fill(0xc4a35a);
		this.icon.stroke({ width: 1, color: 0x8b7355 });
		this.view.addChild(this.icon);

		this.view.eventMode = "static";
		this.view.cursor = "pointer";
	}

	/** Directly below the profile panel, left-aligned to it, small gap. */
	layout(
		characterX: number,
		characterY: number,
		characterHeight: number,
	): void {
		this.view.x = characterX;
		this.view.y = characterY + characterHeight + 8;
	}

	hitTest(screenX: number, screenY: number): boolean {
		const s = this.view.scale.x || 1;
		const lx = (screenX - this.view.x) / s;
		const ly = (screenY - this.view.y) / s;
		return lx >= 0 && lx <= 40 && ly >= 0 && ly <= 40;
	}
}
