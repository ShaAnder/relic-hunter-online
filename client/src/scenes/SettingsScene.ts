import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { AudioSettingsPanel } from "@/ui/AudioSettingsPanel";
import { computeFitScale } from "@/math/fitScale";
import { MainMenuScene } from "./MainMenuScene";

/**
 * Settings — currently just the Audio tab, but built as a tab shell
 * (a row of tab buttons switching which panel is visible) rather than
 * an audio-only screen, so adding a second tab later means adding a
 * panel, not restructuring this scene.
 */
export class SettingsScene implements Scene {
	readonly view = new Container();
	private content = new Container();

	private title!: Text;
	private backButton!: Button;
	private audioPanel!: AudioSettingsPanel;

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
			text: "Settings",
			style: { fill: 0xffffff, fontSize: 36, fontWeight: "bold" },
		});
		this.content.addChild(this.title);

		this.audioPanel = new AudioSettingsPanel(this.game, this.game.app.stage);
		this.content.addChild(this.audioPanel.view);

		this.backButton = new Button({
			text: "Back",
			width: 160,
			height: 50,
			onClick: () => {
				void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
			},
		});
		this.content.addChild(this.backButton.view);
	}

	private layout(width: number, height: number): void {
		this.title.x = this.DESIGN_WIDTH / 2 - this.title.width / 2;
		this.title.y = this.DESIGN_HEIGHT * 0.15;

		this.audioPanel.view.x = this.DESIGN_WIDTH / 2 - 120;
		this.audioPanel.view.y = this.DESIGN_HEIGHT * 0.32;

		this.backButton.view.x = this.DESIGN_WIDTH / 2 - 80;
		this.backButton.view.y = this.DESIGN_HEIGHT * 0.8;

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
