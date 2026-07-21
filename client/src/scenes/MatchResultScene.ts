import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/Scene";
import type { Game } from "@/core/Game";
import { Button } from "@/ui/generics/Button";
import { LobbyScene } from "./LobbyScene";

/**
 * Minimal match result screen per `11-item-inventory-win-design.md`: a
 * win/loss headline, turns taken, items extracted, and a button back to
 * the Lobby. Reads game.session.matchResult (set by MapScene) and clears
 * it on return so a stale result can't leak into the next match.
 *
 * Deeper stats (damage dealt, tiles moved, etc.) are a later addition once
 * there's more gameplay generating numbers worth showing — deliberately
 * bare for this pass.
 */
export class MatchResultScene implements Scene {
	readonly view = new Container();

	private headline!: Text;
	private statsText!: Text;
	private returnBtn!: Button;

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
		const result = this.game.session.matchResult;

		this.headline = new Text({
			text: result?.won ? "🎉 Extracted!" : "Match Ended",
			style: {
				fill: result?.won ? 0xffd700 : 0xffffff,
				fontSize: 40,
				fontWeight: "bold",
			},
		});
		this.view.addChild(this.headline);

		const lines = result
			? [
					`Turns taken: ${result.turnsTaken}`,
					`Items extracted: ${result.itemsExtracted}`,
				]
			: ["No match data — did you get here directly?"];

		this.statsText = new Text({
			text: lines.join("\n"),
			style: { fill: 0xffffff, fontSize: 18, fontFamily: "monospace" },
		});
		this.view.addChild(this.statsText);

		this.returnBtn = new Button({
			text: "Return to Lobby",
			width: 220,
			height: 52,
			fontSize: 18,
			bgColor: 0x1b5e20,
			activeColor: 0x2e7d32,
			onClick: () => this.onReturnToLobby(),
		});
		this.view.addChild(this.returnBtn.view);
	}

	/** Clear the consumed result so a stale one can't leak into the next match. */
	private onReturnToLobby(): void {
		this.game.session.matchResult = null;
		void this.game.sceneManager.changeScene(new LobbyScene(this.game));
	}

	private layout(width: number, height: number): void {
		this.headline.x = width / 2 - this.headline.width / 2;
		this.headline.y = height * 0.28;

		this.statsText.x = width / 2 - this.statsText.width / 2;
		this.statsText.y = height * 0.42;

		this.returnBtn.view.x = width / 2 - 110;
		this.returnBtn.view.y = height * 0.62;
	}
}
