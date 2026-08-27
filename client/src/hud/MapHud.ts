import { Container, Text, Ticker } from "pixi.js";
import type { Game } from "@/core/game/Game";
import { RefocusButton } from "@/ui/buttons/RefocusButton";
import { LogsButton } from "@/ui/buttons/LogButton";
import { LogPanel } from "@/ui/LogPanel";
import type { MatchLogEntry } from "@/core/game/GameSession";
import { uiPx } from "@/math/uiScale";

/**
 * Owns the map's presentation chrome under one root. Widgets move in
 * here incrementally, safest/most isolated first.
 * @author ShaAnder
 */
export class MapHud {
	readonly view = new Container();
	private bossAlertText: Text;
	private feedbackText: Text;
	private feedbackTimer = 0;
	private refocusButton: RefocusButton;
	private logsButton: LogsButton;
	private logPanel: LogPanel;

	constructor(private game: Game) {
		this.bossAlertText = new Text({
			text: "⚠ ALERT ⚠",
			style: { fill: 0xff2222, fontSize: 72, fontWeight: "bold" },
		});
		this.bossAlertText.anchor.set(0.5);
		this.bossAlertText.visible = false;
		this.view.addChild(this.bossAlertText);

		this.feedbackText = new Text({
			text: "",
			style: {
				fill: 0xffd700,
				fontSize: 16,
				fontWeight: "bold",
				wordWrap: true,
				wordWrapWidth: 480,
				align: "center",
			},
		});
		this.feedbackText.visible = false;
		this.view.addChild(this.feedbackText);

		this.refocusButton = new RefocusButton();
		this.view.addChild(this.refocusButton.view);

		this.logsButton = new LogsButton();
		this.view.addChild(this.logsButton.view);

		this.logPanel = new LogPanel();
		this.view.addChild(this.logPanel.view);
	}

	/** Both roots — MapScene's uiSurfaces list uses these for click-through exclusion. */
	get logsButtonView(): Container {
		return this.logsButton.view;
	}
	get logPanelView(): Container {
		return this.logPanel.view;
	}

	/** Next to inspectButton — anchorX/Y are inspectButton's own position, still owned by MapScene. */
	layoutLogsButton(
		anchorX: number,
		anchorY: number,
		btn: number,
		gap: number,
	): void {
		this.logsButton.view.x = anchorX + btn + gap;
		this.logsButton.view.y = anchorY;
	}

	/** Below bagButton — anchorX/Y are bagButton's own position, still owned by MapScene. */
	layoutLogPanel(anchorX: number, anchorY: number, s: number): void {
		this.logPanel.view.x = anchorX;
		this.logPanel.view.y = anchorY + uiPx(56, s);
	}

	hitTestLogsButton(screenX: number, screenY: number): boolean {
		return this.logsButton.hitTest(screenX, screenY);
	}

	toggleLogPanel(): void {
		this.logPanel.toggle();
	}

	get isLogPanelOpen(): boolean {
		return this.logPanel.isOpen;
	}

	closeLogPanelIfOpen(): void {
		if (this.logPanel.isOpen) this.logPanel.toggle();
	}

	syncLogPanel(matchLog: MatchLogEntry[]): void {
		this.logPanel.sync(matchLog);
	}

	setLogsChromeVisible(visible: boolean): void {
		this.logsButton.view.visible = visible;
	}

	/** Its own root — MapScene's uiSurfaces list uses this for click-through exclusion. */
	get refocusView(): Container {
		return this.refocusButton.view;
	}

	/** Center-right edge — same formula as before, now owned here. */
	layoutRefocusButton(w: number, h: number, s: number): void {
		this.refocusButton.view.x = w - uiPx(28, s);
		this.refocusButton.view.y = h / 2;
	}

	hitTestRefocus(screenX: number, screenY: number): boolean {
		return this.refocusButton.hitTest(screenX, screenY);
	}

	setRefocusVisible(visible: boolean): void {
		this.refocusButton.view.visible = visible;
	}

	/** Ticks the feedback message's auto-hide timer — call every frame from MapScene's own update(). */
	update(deltaTime: number): void {
		if (this.feedbackTimer > 0) {
			this.feedbackTimer -= deltaTime;
			if (this.feedbackTimer <= 0) {
				this.feedbackText.visible = false;
			}
		}
	}

	/** Shows a temporary message, wrapped/centered/capped to 7 words, below the HUD row, auto-hides after ~2.5s. */
	showFeedbackMessage(message: string): void {
		this.feedbackText.text = this.capToSevenWords(message);
		this.feedbackText.visible = true;
		this.feedbackText.x =
			(this.game.app.screen.width - this.feedbackText.width) / 2;
		// Below CharacterPanel's own bottom edge (16px margin + its
		// 110px height), not the old y=60 that cut across it.
		this.feedbackText.y = 140;
		this.feedbackTimer = 150;
	}

	/** 7-word cap, counting a leading emoji as one word — keeps messages skimmable at a glance. */
	private capToSevenWords(message: string): string {
		const words = message.split(" ");
		if (words.length <= 7) return message;
		return words.slice(0, 7).join(" ") + "…";
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
