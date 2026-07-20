import { Container, Text } from "pixi.js";
import type { Scene } from "../core/Scene";
import type { Game } from "../core/Game";
import { Button } from "../ui/generics/Button";
import { LobbyScene } from "./LobbyScene";
import { MapScene } from "./MapScene";
import type { MissionParams } from "../core/GameSession";

/**
 * Per-match config: map size only (enemy count fixed at 4 for this pass).
 * Start writes missionParams into the session and enters MapScene.
 * LoadingScene will be inserted later without changing this contract.
 */
export class MissionSelectScene implements Scene {
	readonly view = new Container();

	private title!: Text;
	private sizeButtons: Button[] = [];
	private startBtn!: Button;
	private backBtn!: Button;
	private selectedSize: MissionParams["mapSize"] = "M";

	constructor(private game: Game) {}

	onEnter(): void {
		this.buildUI();
		this.refreshSizeButtons();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onExit(): void {}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	private buildUI(): void {
		this.title = new Text({
			text: "Select Mission",
			style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
		});
		this.view.addChild(this.title);

		const sizes: MissionParams["mapSize"][] = ["S", "M", "L"];
		for (const size of sizes) {
			const btn = new Button({
				text: `Map ${size}`,
				width: 120,
				height: 48,
				fontSize: 18,
				onClick: () => {
					this.selectedSize = size;
					this.refreshSizeButtons();
				},
			});
			this.sizeButtons.push(btn);
			this.view.addChild(btn.view);
		}

		this.startBtn = new Button({
			text: "Start Mission",
			width: 200,
			height: 52,
			fontSize: 18,
			bgColor: 0x1b5e20,
			activeColor: 0x2e7d32,
			onClick: () => this.onStart(),
		});
		this.view.addChild(this.startBtn.view);

		this.backBtn = new Button({
			text: "Back",
			width: 140,
			height: 44,
			fontSize: 16,
			onClick: () => {
				void this.game.sceneManager.changeScene(new LobbyScene(this.game));
			},
		});
		this.view.addChild(this.backBtn.view);
	}

	private refreshSizeButtons(): void {
		const sizes: MissionParams["mapSize"][] = ["S", "M", "L"];
		this.sizeButtons.forEach((btn, i) => {
			btn.setActive(sizes[i] === this.selectedSize);
		});
	}

	private onStart(): void {
		this.game.session.missionParams = { mapSize: this.selectedSize };
		// LoadingScene will sit between these two later.
		void this.game.sceneManager.changeScene(new MapScene(this.game));
	}

	private layout(width: number, height: number): void {
		this.title.x = width / 2 - this.title.width / 2;
		this.title.y = height * 0.22;

		const totalW = 3 * 120 + 2 * 20;
		const startX = width / 2 - totalW / 2;
		this.sizeButtons.forEach((btn, i) => {
			btn.view.x = startX + i * 140;
			btn.view.y = height * 0.4;
		});

		this.startBtn.view.x = width / 2 - 100;
		this.startBtn.view.y = height * 0.55;

		this.backBtn.view.x = width / 2 - 70;
		this.backBtn.view.y = height * 0.7;
	}
}
