import { Container, Graphics, Text } from "pixi.js";

const BUTTON_WIDTH = 100;
const BUTTON_HEIGHT = 40;

/**
 * Plain clickable move button, when click activates "move mode"
 * When off player can look around freely when moving player camera
 * clamped and player can move character
 */
export class MoveButton {
	readonly view = new Container();
	private background = new Graphics();
	private label: Text;
	private active = false;

	constructor() {
		this.label = new Text({
			text: "Move",
			style: {
				fill: 0xffffff,
				fontSize: 16,
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

	setActive(active: boolean): void {
		this.active = active;
		this.redraw();
	}

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

	private redraw(): void {
		this.background.clear();
		this.background.roundRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 6);
		this.background.fill(this.active ? 0x4a9eff : 0x2a2a2a);
		this.background.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
	}
}
