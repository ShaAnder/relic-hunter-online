import { Container, Graphics, Text } from "pixi.js";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import { Button } from "../generics/Button";
import { MainMenuScene } from "@/scenes/MainMenuScene";

/**
 * Pause menu shown on top of MapScene (or any scene) without touching it —
 * the scene underneath stays fully intact, just paused, ready to resume
 * exactly where it left off. See OverlayManager for how that's enforced.
 */
export class PauseOverlay implements Overlay {
	readonly view = new Container();

	private dimBg = new Graphics();
	private panel = new Container();
	private title!: Text;
	private buttons: Button[] = [];

	constructor(private game: Game) {}

	onShow(): void {
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onHide(): void {
		// Buttons live on the view Overlay manager removes whole view
	}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	// ---------- Construction ----------

	private buildUI(): void {
		// Full-screen dim backdrop — also what blocks clicks reaching the scene beneath
		this.dimBg.eventMode = "static";
		this.view.addChild(this.dimBg);

		this.title = new Text({
			text: "Paused",
			style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
		});
		this.panel.addChild(this.title);

		const items: { label: string; action: () => void }[] = [
			{ label: "Resume", action: () => this.onResume() },
			{ label: "Settings", action: () => this.onSettings() },
			{ label: "Main Menu", action: () => this.onMainMenu() },
		];

		for (const item of items) {
			const btn = new Button({
				text: item.label,
				width: 220,
				height: 48,
				fontSize: 18,
				onClick: item.action,
			});
			this.buttons.push(btn);
			this.panel.addChild(btn.view);
		}

		this.view.addChild(this.panel);
	}

	private layout(width: number, height: number): void {
		this.dimBg.clear();
		this.dimBg.rect(0, 0, width, height);
		this.dimBg.fill({ color: 0x000000, alpha: 0.7 });

		this.title.x = -this.title.width / 2;
		this.title.y = 0;

		let btnY = 70;
		for (const btn of this.buttons) {
			btn.view.x = -110;
			btn.view.y = btnY;
			btnY += 62;
		}

		this.panel.x = width / 2;
		this.panel.y = height / 2 - 100;
	}

	// ---------- Actions ----------
	private onResume(): void {
		this.game.overlays.hide();
	}

	private onSettings(): void {
		console.log("[PAUSE] Settings - coming soon");
	}

	private onMainMenu(): void {
		this.game.overlays.hide();
		void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
	}
}
