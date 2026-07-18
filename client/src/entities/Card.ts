import { Container, Graphics, Text } from "pixi.js";

export type CardColor = "blue" | "red" | "yellow" | "green";

export interface CardData {
	id: string;
	color: CardColor;
	name: string;
	value: number | string;
	description: string;
	actionType: "move" | "attack" | "defense" | "stun";
}

export class Card {
	readonly view = new Container();
	private bg = new Graphics();
	private label: Text;
	private data: CardData;

	constructor(data: CardData) {
		this.data = data;

		this.bg = new Graphics();
		this.view.addChild(this.bg);

		this.label = new Text({
			text: data.name,
			style: {
				fill: 0xffffff,
				fontSize: 14,
				fontWeight: "bold",
				align: "center",
			},
		});

		this.label.anchor.set(0.5);
		this.view.addChild(this.label);

		this.redraw();
	}

	private redraw(): void {
		const colors: Record<CardColor, number> = {
			blue: 0x4a9eff,
			red: 0xe74c3c,
			yellow: 0xf1c40f,
			green: 0x2ecc71,
		};

		this.bg.clear();
		this.bg.roundRect(0, 0, 80, 110, 8);
		this.bg.fill(colors[this.data.color]);
		this.bg.stroke({ width: 3, color: 0xffffff });

		this.label.text = this.data.name;
		this.label.x = 40;
		this.label.y = 55;
	}
	getData(): CardData {
		return this.data;
	}

	/** Simple highlight on hover/selection */
	setSelected(selected: boolean): void {
		this.view.alpha = selected ? 1 : 0.85;
		this.bg.scale.set(selected ? 1.08 : 1);
	}
}
