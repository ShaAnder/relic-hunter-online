import { Button } from "./generics/Button";

/**
 * Move button — toggles move mode / card selection.
 * Now a thin wrapper around the generic Button.
 */
export class MoveButton {
	readonly view;
	private button: Button;

	constructor() {
		this.button = new Button({
			text: "Move",
			width: 100,
			height: 40,
			bgColor: 0x2a2a2a,
			activeColor: 0x4a9eff,
			disabledColor: 0x1a1a1a,
		});
		this.view = this.button.view;
	}

	setActive(active: boolean): void {
		this.button.setActive(active);
	}

	setEnabled(enabled: boolean): void {
		this.button.setEnabled(enabled);
	}

	get isEnabled(): boolean {
		return this.button.isEnabled;
	}

	hitTest(screenX: number, screenY: number): boolean {
		return this.button.hitTest(screenX, screenY);
	}
}
