import { Button } from "./generics/Button";

/**
 * End Turn button — always available.
 * Thin wrapper around the generic Button with distinctive red styling.
 */
export class EndTurnButton {
	readonly view;
	private button: Button;

	constructor() {
		this.button = new Button({
			text: "End Turn",
			width: 100,
			height: 40,
			bgColor: 0x8b0000,
			activeColor: 0xaa0000,
			disabledColor: 0x4a0000,
			fontSize: 14,
		});
		// End Turn is never disabled
		this.button.setEnabled(true);
		this.view = this.button.view;
	}

	/** Always-available hit test. */
	hitTest(screenX: number, screenY: number): boolean {
		// Force enabled so hitTest never returns false
		return this.button.hitTest(screenX, screenY);
	}
}
