import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { MainMenuScene } from "./MainMenuScene";

/**
 * Quick in-game help / tutorial page.
 * Accessible from the main menu; returns to MainMenu on Back.
 * @author ShaAnder
 */
export class HelpScene implements Scene {
	readonly view = new Container();

	private title!: Text;
	private body!: Text;
	private backBtn!: Button;

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
			text: "Help / Tutorial",
			style: { fill: 0xffffff, fontSize: 28, fontWeight: "bold" },
		});
		this.view.addChild(this.title);

		const lines = [
			"GOAL  —  Find the target item in a chest, then reach the Exit (or play Blue E while holding it).",
			"",
			"BOTTOM-RIGHT BUTTONS - INNER WHEEL TO OUTER (right to left)",
			"Move ........ Spend AP + Blue card to move",
			"Actions ..... Open outer actions wheel",
			"End Turn .... Finish your turn",
			"Disengage ... Move while ignoring Zones of Control",
			"Rest ........ Heal a little + draw cards",
			"Attack ...... Target an enemy in range",
			"",
			"CARDS (drag onto Play Zone)",
			"Blue ........ Movement  |  E = Exit card",
			"Red ......... Attack bonus",
			"Yellow ...... Defense bonus",
			"Green ....... Traps (coming later)",
			"A = ×2   ·   C = ×1.5",
			"",
			"OTHER",
			"WASD = pan   ·   Wheel = zoom   ·   Esc = cancel / pause",
			"Hover hand to reveal cards   ·   Arrows + Enter to select",
			"",
			"Combat is simultaneous (Attack / Defend / Run / Surrender).",
			"Disengage ignores ZoC. AI hunters have different personalities.",
		].join("\n");

		this.body = new Text({
			text: lines,
			style: {
				fill: 0xdddddd,
				fontSize: 14,
				fontFamily: "monospace",
				lineHeight: 19,
			},
		});
		this.view.addChild(this.body);

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
		this.view.addChild(this.backBtn.view);
	}

	private layout(width: number, height: number): void {
		this.title.x = width / 2 - this.title.width / 2;
		this.title.y = 28;

		this.body.x = Math.max(24, width / 2 - this.body.width / 2);
		this.body.y = 72;

		this.backBtn.view.x = width / 2 - 90;
		this.backBtn.view.y = height - 64;
	}
}
