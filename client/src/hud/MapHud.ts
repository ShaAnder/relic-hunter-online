import { Container, Text, Ticker } from "pixi.js";
import type { Game } from "@/core/game/Game";

/**
 * Owns the map's presentation chrome under one root. Widgets move in
 * here incrementally, safest/most isolated first.
 * @author ShaAnder
 */
export class MapHud {
	readonly view = new Container();
	private bossAlertText: Text;

	constructor(private game: Game) {
		this.bossAlertText = new Text({
			text: "⚠ ALERT ⚠",
			style: { fill: 0xff2222, fontSize: 72, fontWeight: "bold" },
		});
		this.bossAlertText.anchor.set(0.5);
		this.bossAlertText.visible = false;
		this.view.addChild(this.bossAlertText);
	}

	/** Flashing red alert, centered on screen, for durationMs. Resolves once it's done and hidden again. */
	showBossAlert(durationMs: number): Promise<void> {
		return new Promise((resolve) => {
			this.bossAlertText.x = this.game.app.screen.width / 2;
			this.bossAlertText.y = this.game.app.screen.height / 2;
			this.bossAlertText.visible = true;
			const startTime = performance.now();

			const tick = (): void => {
				const elapsedMs = performance.now() - startTime;
				if (elapsedMs >= durationMs) {
					this.bossAlertText.visible = false;
					Ticker.shared.remove(tick);
					resolve();
					return;
				}
				this.bossAlertText.alpha =
					0.4 + Math.abs(Math.sin(elapsedMs / 500)) * 0.6;
			};

			Ticker.shared.add(tick);
		});
	}
}
