import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { computeFitScale } from "@/math/fitScale";
import { LobbyScene } from "./LobbyScene";
import { LoadingOverlay } from "@/ui/overlay/LoadingOverlay";

/**
 * Per-match config. Only one map exists right now — a single 35x35 test
 * map — so this is currently just a confirmation screen rather than a
 * real config picker. Start writes missionParams into the session and
 * enters LoadingScene, which generates the map/chests and does the
 * pre-match reveal before handing off to MapScene itself.
 */
export class MissionSelectScene implements Scene {
	readonly view = new Container();
	private content = new Container();

	private title!: Text;
	private mapLabel!: Text;
	private startBtn!: Button;
	private backBtn!: Button;

	private readonly DESIGN_WIDTH = 700;
	private readonly DESIGN_HEIGHT = 460;

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
			text: "Select Mission",
			style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
		});
		this.content.addChild(this.title);

		this.mapLabel = new Text({
			text: "Test Map",
			style: { fill: 0x88ccff, fontSize: 20 },
		});
		this.content.addChild(this.mapLabel);

		this.startBtn = new Button({
			text: "Start Mission",
			width: 200,
			height: 52,
			fontSize: 18,
			bgColor: 0x1b5e20,
			activeColor: 0x2e7d32,
			onClick: () => this.onStart(),
		});
		this.content.addChild(this.startBtn.view);

		this.backBtn = new Button({
			text: "Back",
			width: 140,
			height: 44,
			fontSize: 16,
			onClick: () => {
				void this.game.sceneManager.changeScene(new LobbyScene(this.game));
			},
		});
		this.content.addChild(this.backBtn.view);
	}

	private onStart(): void {
		this.game.session.missionParams = {};
		void this.game.overlays.show(new LoadingOverlay(this.game));
	}

	private layout(width: number, height: number): void {
		this.title.x = this.DESIGN_WIDTH / 2 - this.title.width / 2;
		this.title.y = this.DESIGN_HEIGHT * 0.22;

		this.mapLabel.x = this.DESIGN_WIDTH / 2 - this.mapLabel.width / 2;
		this.mapLabel.y = this.DESIGN_HEIGHT * 0.4;

		this.startBtn.view.x = this.DESIGN_WIDTH / 2 - 100;
		this.startBtn.view.y = this.DESIGN_HEIGHT * 0.55;

		this.backBtn.view.x = this.DESIGN_WIDTH / 2 - 70;
		this.backBtn.view.y = this.DESIGN_HEIGHT * 0.7;

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
