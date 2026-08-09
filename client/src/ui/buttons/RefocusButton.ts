import { Container, Graphics } from "pixi.js";

/**
 * Recenters the camera on the player's own character — sits above the
 * radial wheel, since a player can lose track of their position after
 * panning around or watching AI/monster turns play out elsewhere.
 * @author ShaAnder
 */
export class RefocusButton {
	readonly view = new Container();
	private bg = new Graphics();
	private icon = new Graphics();

	constructor() {
		this.bg.circle(0, 0, 20);
		this.bg.fill(0x2a2a2a);
		this.bg.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
		this.view.addChild(this.bg);

		// Simple crosshair/recenter glyph
		this.icon.circle(0, 0, 6);
		this.icon.stroke({ width: 2, color: 0xffffff });
		this.icon.moveTo(0, -12);
		this.icon.lineTo(0, -7);
		this.icon.moveTo(0, 7);
		this.icon.lineTo(0, 12);
		this.icon.moveTo(-12, 0);
		this.icon.lineTo(-7, 0);
		this.icon.moveTo(7, 0);
		this.icon.lineTo(12, 0);
		this.icon.stroke({ width: 2, color: 0xffffff });
		this.view.addChild(this.icon);

		this.view.eventMode = "static";
		this.view.cursor = "pointer";
	}

	/** Anchored directly above the wheel's own screen position. */
	layout(wheelX: number, wheelY: number, gapAboveWheel: number): void {
		this.view.x = wheelX;
		this.view.y = wheelY - gapAboveWheel;
	}

	hitTest(screenX: number, screenY: number): boolean {
		const dx = screenX - this.view.x;
		const dy = screenY - this.view.y;
		return dx * dx + dy * dy <= 20 * 20;
	}
}
