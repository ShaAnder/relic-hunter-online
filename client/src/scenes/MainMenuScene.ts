import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { CharacterCreationScene } from "./CharacterCreationScene";
import { LoadGameScene } from "./LoadGameScene";

/**
 * Top-level menu after the eventual Landing "Press Start".
 * New Character / Load Character / Settings.
 */
export class MainMenuScene implements Scene {
	readonly view = new Container();

	private title!: Text;
	private buttons: Button[] = [];

	constructor(private game: Game) {}

	onEnter(): void {
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onExit(): void {}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	private buildUI(): void {
		this.title = new Text({
			text: "Relic Hunter Online",
			style: { fill: 0xffffff, fontSize: 42, fontWeight: "bold" },
		});
		this.view.addChild(this.title);

		const items: { label: string; action: () => void }[] = [
			{
				label: "New Character",
				action: () => {
					void this.game.sceneManager.changeScene(
						new CharacterCreationScene(this.game),
					);
				},
			},
			{
				label: "Load Character",
				action: () => {
					void this.game.sceneManager.changeScene(new LoadGameScene(this.game));
				},
			},
			{
				label: "Settings",
				action: () => {
					// Stub — SettingsScene comes with the later nav pass
					console.log("[MainMenu] Settings — Coming Soon");
				},
			},
		];

		for (const item of items) {
			const btn = new Button({
				text: item.label,
				width: 240,
				height: 52,
				fontSize: 20,
				onClick: item.action,
			});
			this.buttons.push(btn);
			this.view.addChild(btn.view);
		}
	}

	private layout(width: number, height: number): void {
		this.title.x = width / 2 - this.title.width / 2;
		this.title.y = height * 0.22;

		const startY = height * 0.4;
		this.buttons.forEach((btn, i) => {
			btn.view.x = width / 2 - 120;
			btn.view.y = startY + i * 70;
		});
	}
}
