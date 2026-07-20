import { Container, Graphics, Text } from "pixi.js";

export interface ButtonConfig {
	text: string;
	width?: number;
	height?: number;
	bgColor?: number;
	activeColor?: number;
	disabledColor?: number;
	textColor?: number;
	fontSize?: number;
	onClick?: () => void;
}

/**
 * Generic reusable button.
 * Used by MoveButton, EndTurnButton, and future character-creation UI.
 * ActionButton keeps its own composite logic for the sub-menu.
 */
export class Button {
	readonly view = new Container();
	protected bg = new Graphics();
	protected label: Text;
	protected config: Required<ButtonConfig>;
	protected active = false;
	protected enabled = true;

	constructor(config: ButtonConfig) {
		this.config = {
			width: 100,
			height: 40,
			bgColor: 0x2a2a2a,
			activeColor: 0x4a9eff,
			disabledColor: 0x1a1a1a,
			textColor: 0xffffff,
			fontSize: 16,
			onClick: () => {},
			...config,
		};

		this.label = new Text({
			text: this.config.text,
			style: {
				fill: this.config.textColor,
				fontSize: this.config.fontSize,
				fontWeight: "bold",
			},
		});
		this.label.anchor.set(0.5);

		this.view.addChild(this.bg);
		this.view.addChild(this.label);

		this.redraw();
		this.setupEvents();
	}

	protected redraw(): void {
		this.bg.clear();
		this.bg.roundRect(0, 0, this.config.width, this.config.height, 6);

		if (!this.enabled) {
			this.bg.fill(this.config.disabledColor);
			this.bg.stroke({ width: 2, color: 0x555555, alpha: 0.5 });
			this.label.alpha = 0.35;
		} else if (this.active) {
			this.bg.fill(this.config.activeColor);
			this.bg.stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
			this.label.alpha = 1;
		} else {
			this.bg.fill(this.config.bgColor);
			this.bg.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
			this.label.alpha = 1;
		}

		this.label.x = this.config.width / 2;
		this.label.y = this.config.height / 2;
	}

	private setupEvents(): void {
		this.view.eventMode = "static";
		this.view.on("pointerdown", () => {
			if (this.enabled && this.config.onClick) this.config.onClick();
		});
	}

	setActive(active: boolean): void {
		this.active = active;
		this.redraw();
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (!enabled) this.active = false;
		this.redraw();
	}

	get isEnabled(): boolean {
		return this.enabled;
	}

	hitTest(screenX: number, screenY: number): boolean {
		if (!this.enabled) return false;
		const localX = screenX - this.view.x;
		const localY = screenY - this.view.y;
		return (
			localX >= 0 &&
			localX <= this.config.width &&
			localY >= 0 &&
			localY <= this.config.height
		);
	}

	setText(text: string): void {
		this.label.text = text;
	}
}
