import { Container, Graphics, Text } from "pixi.js";

const BUTTON_WIDTH = 100;
const BUTTON_HEIGHT = 40;

/**
 * Clickable Move button that toggles "move mode".
 *
 * Three visual states: enabled+inactive (dark, ready), enabled+active
 * (blue, aiming), and disabled (greyed — the turn's single Move is spent).
 * Greying out after the Move teaches the action-economy rhythm before
 * dice and cards exist.
 */
export class MoveButton {
	readonly view = new Container();

	// Visual pieces + state
	private background = new Graphics();
	private label: Text;
	private active = false;
	private enabled = true;

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

	/** Toggle the aiming highlight. */
	setActive(active: boolean): void {
		this.active = active;
		this.redraw();
	}

	/**
	 * Enable or grey out the button.
	 * Disabling also clears active so re-enabling can't show a stale highlight.
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (!enabled) this.active = false;
		this.redraw();
	}

	/** Whether the button currently accepts clicks. */
	get isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * Screen-space hit check.
	 * Returns false while disabled so clicks fall through to the scene.
	 */
	hitTest(screenX: number, screenY: number): boolean {
		if (!this.enabled) return false;
		const localX = screenX - this.view.x;
		const localY = screenY - this.view.y;
		return (
			localX >= 0 &&
			localX <= BUTTON_WIDTH &&
			localY >= 0 &&
			localY <= BUTTON_HEIGHT
		);
	}

	/** Redraw background + label for the current state. */
	private redraw(): void {
		this.background.clear();
		this.background.roundRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 6);

		if (!this.enabled) {
			this.background.fill(0x1a1a1a);
			this.background.stroke({ width: 2, color: 0x555555, alpha: 0.5 });
			this.label.alpha = 0.35;
		} else if (this.active) {
			this.background.fill(0x4a9eff);
			this.background.stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
			this.label.alpha = 1;
		} else {
			this.background.fill(0x2a2a2a);
			this.background.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
			this.label.alpha = 1;
		}
	}
}
