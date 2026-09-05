import { Container, Graphics, Text } from "pixi.js";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { AudioSettingsPanel } from "@/ui/AudioSettingsPanel";

/**
 * Settings, reached mid-game (e.g. from PauseOverlay) — deliberately
 * an Overlay, not a Scene. Scene.changeScene() would tear down and
 * eventually rebuild MapScene entirely just to look at a volume
 * slider; showOnTop()/hideTop() instead layer this on top of whatever
 * called it (PauseOverlay) and remove just this one layer when done,
 * leaving everything underneath completely undisturbed the whole time.
 */
export class SettingsOverlay implements Overlay {
	readonly view = new Container();

	private dimBg = new Graphics();
	private panel = new Container();
	private title!: Text;
	private audioPanel!: AudioSettingsPanel;
	private backButton!: Button;

	constructor(private game: Game) {}

	onShow(): void {
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onHide(): void {}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	private buildUI(): void {
		this.dimBg.eventMode = "static";
		this.view.addChild(this.dimBg);

		this.title = new Text({
			text: "Settings",
			style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
		});
		this.panel.addChild(this.title);

		this.audioPanel = new AudioSettingsPanel(this.game, this.game.app.stage);
		this.panel.addChild(this.audioPanel.view);

		this.backButton = new Button({
			text: "Back",
			width: 160,
			height: 48,
			onClick: () => this.game.overlays.hideTop(),
		});
		this.panel.addChild(this.backButton.view);

		this.view.addChild(this.panel);
	}

	private layout(width: number, height: number): void {
		this.dimBg.clear();
		this.dimBg.rect(0, 0, width, height);
		this.dimBg.fill({ color: 0x000000, alpha: 0.7 });

		this.title.x = -this.title.width / 2;
		this.title.y = 0;

		this.audioPanel.view.x = -120;
		this.audioPanel.view.y = 60;

		this.backButton.view.x = -80;
		this.backButton.view.y = 300;

		this.panel.x = width / 2;
		this.panel.y = height / 2 - 150;
	}
}
