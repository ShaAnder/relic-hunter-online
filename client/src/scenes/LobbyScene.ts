import { Container, Text } from "pixi.js";
import type { Scene } from "../core/Scene";
import type { Game } from "../core/Game";

export class LobbyScene implements Scene {
	readonly view = new Container();
	private label: Text;

	constructor(private game: Game) {
		this.label = new Text({
			text: "Relic Hunter Online",
			style: { fill: 0xffffff, fontSize: 48, fontWeight: "bold" },
		});
		this.view.addChild(this.label);
	}

	onEnter(): void {
		this.centerLabel();
	}
	onExit(): void {
		// cleanup fn later
	}

	update(_deltaTime: number): void {
		// add per frame logic here
	}

	onResize(width: number, height: number): void {
		this.centerLabel(width, height);
	}

	private centerLabel(
		width = this.game.app.screen.width,
		height = this.game.app.screen.height,
	) {
		this.label.x = width / 2 - this.label.width / 2;
		this.label.y = height / 2 - this.label.height / 2;
	}
}
