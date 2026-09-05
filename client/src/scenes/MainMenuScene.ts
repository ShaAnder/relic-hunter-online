import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { computeFitScale } from "@/math/fitScale";
import { CharacterCreationScene } from "./CharacterCreationScene";
import { LoadGameScene } from "./LoadGameScene";
import { TutorialsMenuScene } from "./TutorialScene";
import { SettingsScene } from "./SettingsScene";

/**
 * Top-level menu after the eventual Landing "Press Start".
 * New Character / Load Character / Settings.
 */
export class MainMenuScene implements Scene {
	readonly view = new Container();
	private content = new Container();

	private title!: Text;
	private buttons: Button[] = [];

	// The size this layout is actually designed against — real numbers
	// pulled from the original fixed layout math, not arbitrary.
	private readonly DESIGN_WIDTH = 800;
	private readonly DESIGN_HEIGHT = 720;

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
		this.view.addChild(this.content);

		this.title = new Text({
			text: "Relic Hunter Online",
			style: { fill: 0xffffff, fontSize: 42, fontWeight: "bold" },
		});
		this.content.addChild(this.title);

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
				label: "Tutorials",
				action: () => {
					void this.game.sceneManager.changeScene(
						new TutorialsMenuScene(this.game),
					);
				},
			},
			{
				label: "Settings",
				action: () => {
					void this.game.sceneManager.changeScene(new SettingsScene(this.game));
				},
			},
		];

		for (const item of items) {
			const btn = new Button({
				text: item.label,
				width: 276,
				height: 60,
				fontSize: 23,
				onClick: item.action,
			});
			this.buttons.push(btn);
			this.content.addChild(btn.view);
		}
	}

	private layout(width: number, height: number): void {
		// Design-space positions — same math as before, but relative to
		// the fixed DESIGN_WIDTH/HEIGHT, never the real screen size.
		this.title.x = this.DESIGN_WIDTH / 2 - this.title.width / 2;
		this.title.y = this.DESIGN_HEIGHT * 0.22;

		const startY = this.DESIGN_HEIGHT * 0.4;
		this.buttons.forEach((btn, i) => {
			btn.view.x = this.DESIGN_WIDTH / 2 - 138;
			btn.view.y = startY + i * 78;
		});

		// One uniform scale for the whole menu, then center the scaled
		// result in whatever space is actually available.
		const scale = computeFitScale(
			width,
			height,
			this.DESIGN_WIDTH,
			this.DESIGN_HEIGHT,
		);
		this.content.scale.set(scale);
		this.content.x = (width - this.DESIGN_WIDTH * scale) / 2;
		this.content.y = (height - this.DESIGN_HEIGHT * scale) / 2;
	}
}
