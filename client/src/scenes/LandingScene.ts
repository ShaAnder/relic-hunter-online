import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { computeFitScale } from "@/math/fitScale";
import { MainMenuScene } from "./MainMenuScene";

/**
 * The actual first screen — before MainMenuScene, not instead of it.
 * Its only job is to be the deliberate, visible "click to begin"
 * moment: browsers refuse to play any audio at all until a genuine
 * user gesture happens (see AudioService's own unlock() docs), and
 * rather than leaving that requirement invisible (Game.create()'s
 * global listener satisfies it silently), this makes it an intentional
 * part of the experience instead of an accident of "whatever the
 * player happened to click first."
 */
export class LandingScene implements Scene {
	readonly view = new Container();
	private content = new Container();

	private title!: Text;
	private prompt!: Text;

	private readonly DESIGN_WIDTH = 800;
	private readonly DESIGN_HEIGHT = 720;

	// Bound once so addEventListener and removeEventListener refer to
	// the exact same function reference — an inline arrow function
	// passed separately to each call would not be removable.
	private readonly handleInput = () => this.begin();

	constructor(private game: Game) {}

	onEnter(): void {
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);

		window.addEventListener("pointerdown", this.handleInput);
		window.addEventListener("keydown", this.handleInput);
	}

	onExit(): void {
		window.removeEventListener("pointerdown", this.handleInput);
		window.removeEventListener("keydown", this.handleInput);
	}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	private begin(): void {
		this.game.audio.unlock();
		this.game.audio.playMusic("menu");
		void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
	}

	private buildUI(): void {
		this.view.addChild(this.content);

		this.title = new Text({
			text: "Relic Hunter Online",
			style: { fill: 0xffffff, fontSize: 42, fontWeight: "bold" },
		});
		this.content.addChild(this.title);

		this.prompt = new Text({
			text: "Click or press any key to begin",
			style: { fill: 0xaaaaaa, fontSize: 20 },
		});
		this.content.addChild(this.prompt);
	}

	private layout(width: number, height: number): void {
		this.title.x = this.DESIGN_WIDTH / 2 - this.title.width / 2;
		this.title.y = this.DESIGN_HEIGHT * 0.4;

		this.prompt.x = this.DESIGN_WIDTH / 2 - this.prompt.width / 2;
		this.prompt.y = this.title.y + this.title.height + 40;

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
