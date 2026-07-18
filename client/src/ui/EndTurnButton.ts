import { Container, Graphics, Text } from "pixi.js";

const BUTTON_WIDTH = 100;
const BUTTON_HEIGHT = 40;

/**
 * End Turn button — always available, ends the turn immediately.
 *
 * Mirrors Pass in that it has no disabled state, but is visually distinct
 * to signal finality. [E] is the keyboard equivalent — both paths call the
 * same handler in MapScene so behaviour is always in sync.
 */
export class EndTurnButton {
	readonly view = new Container();

	// Visual pieces
	private background = new Graphics();
	private label: Text;

	constructor() {
		this.label = new Text({
			text: "End Turn",
			style: {
				fill: 0xffffff,
				fontSize: 14,
				fontWeight: "bold",
			},
		});
		this.label.anchor.set(0.5);
		this.label.x = BUTTON_WIDTH / 2;
		this.label.y = BUTTON_HEIGHT / 2;

		this.view.addChild(this.background);
		this.view.addChild(this.label);
		this.redraw();
	}

	/** Always-available hit test — End Turn can never be disabled. */
	hitTest(screenX: number, screenY: number): boolean {
		const localX = screenX - this.view.x;
		const localY = screenY - this.view.y;
		return (
			localX >= 0 &&
			localX <= BUTTON_WIDTH &&
			localY >= 0 &&
			localY <= BUTTON_HEIGHT
		);
	}

	/** Single static style — no state variants, always clickable. */
	private redraw(): void {
		this.background.clear();
		this.background.roundRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 6);
		this.background.fill(0x8b0000);
		this.background.stroke({ width: 2, color: 0xff4444, alpha: 0.8 });
	}
}
