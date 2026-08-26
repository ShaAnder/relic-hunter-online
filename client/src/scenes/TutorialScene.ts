import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { computeFitScale } from "@/math/fitScale";
import { LoadingOverlay } from "@/ui/overlay/LoadingOverlay";
import { MainMenuScene } from "./MainMenuScene";
import { TutorialRunner } from "@/tutorial/tutorialRunner";
import { MOVEMENT_SCRIPT } from "@/tutorial/scripts/movementScript";
import { COMBAT_SCRIPT } from "@/tutorial/scripts/combatScript";
import { MapScene } from "@/scenes/MapScene";
import type { TutorialConfig } from "@/tutorial/tutorialTypes";
import type { TutorialPort } from "@/tutorial/tutorialPort";

/**
 * Tutorials hub — six real, comprehensive tutorials covering everything
 * essential to actually play a match, plus six locked placeholder slots
 * for more granular tutorials later. Real ones launch an actual match,
 * same path as Mission Select — genuine objective-tracking and a
 * guided, tutorial-specific map setup are the explicitly deferred next
 * step, not this pass. Returns to MainMenu on Back.
 * @author ShaAnder
 */
export class TutorialsMenuScene implements Scene {
	readonly view = new Container();
	private content = new Container();

	private title!: Text;
	private tutorialButtons: Button[] = [];
	private backBtn!: Button;

	private readonly DESIGN_WIDTH = 900;
	private readonly DESIGN_HEIGHT = 560;

	/** Only the first 6 are real — the rest render locked. */
	private static readonly TOPICS = [
		"Movement",
		"Cards & Play Zone",
		"Combat",
		"Items & Inventory",
		"Winning & Losing",
		"Threats on the Map",
		"Coming Soon",
		"Coming Soon",
		"Coming Soon",
		"Coming Soon",
		"Coming Soon",
		"Coming Soon",
	];

	private static readonly REAL_TUTORIAL_COUNT = 6;

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
			text: "Tutorials",
			style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
		});
		this.content.addChild(this.title);

		TutorialsMenuScene.TOPICS.forEach((topic, i) => {
			const isLocked = i >= TutorialsMenuScene.REAL_TUTORIAL_COUNT;
			const btn = new Button({
				text: isLocked ? `🔒 ${topic}` : topic,
				width: 200,
				height: 46,
				fontSize: 14,
				onClick: isLocked ? () => {} : () => this.startTutorial(topic),
			});
			if (isLocked) btn.setEnabled(false);
			this.tutorialButtons.push(btn);
			this.content.addChild(btn.view);
		});

		this.backBtn = new Button({
			text: "Back to Menu",
			width: 180,
			height: 42,
			fontSize: 16,
			bgColor: 0x2a2a2a,
			activeColor: 0x4a9eff,
			onClick: () => {
				void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
			},
		});
		this.content.addChild(this.backBtn.view);
	}

	/**
	 * Launches a real match via the same missionParams + LoadingOverlay
	 * flow MissionSelectScene uses. No tutorial-specific objectives or
	 * guided setup yet — that's the next real build, not this pass.
	 */
	/**
	 * Constructs the real TutorialPort — a MapScene, switched to via
	 * the normal scene-change path. This is the one place in the app
	 * that constructs MapScene for tutorial purposes.
	 */
	private async buildPort(config: TutorialConfig): Promise<TutorialPort> {
		const scene = new MapScene(this.game, config);
		await this.game.sceneManager.changeScene(scene);
		return scene;
	}

	private startTutorial(topic: string): void {
		if (topic === "Movement") {
			const runner = new TutorialRunner(
				(config) => this.buildPort(config),
				MOVEMENT_SCRIPT,
				() => {
					void this.game.sceneManager.changeScene(
						new TutorialsMenuScene(this.game),
					);
				},
			);
			void runner.start();
			return;
		}
		if (topic === "Combat") {
			const runner = new TutorialRunner(
				(config) => this.buildPort(config),
				COMBAT_SCRIPT,
				() => {
					void this.game.sceneManager.changeScene(
						new TutorialsMenuScene(this.game),
					);
				},
			);
			void runner.start();
			return;
		}
		// Other four real topics don't have scripts yet.
		console.log(`[Tutorials] Launching: ${topic}`);
		this.game.session.missionParams = {};
		void this.game.overlays.show(new LoadingOverlay(this.game));
	}

	private layout(width: number, height: number): void {
		this.title.x = this.DESIGN_WIDTH / 2 - this.title.width / 2;
		this.title.y = 20;

		// 4 columns x 3 rows
		const cols = 4;
		const colGap = 24;
		const rowGap = 16;
		const btnW = 200;
		const btnH = 46;
		const gridW = cols * btnW + (cols - 1) * colGap;
		const startX = this.DESIGN_WIDTH / 2 - gridW / 2;
		const startY = 84;

		this.tutorialButtons.forEach((btn, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			btn.view.x = startX + col * (btnW + colGap);
			btn.view.y = startY + row * (btnH + rowGap);
		});

		this.backBtn.view.x = this.DESIGN_WIDTH / 2 - 90;
		this.backBtn.view.y = this.DESIGN_HEIGHT - 60;

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
