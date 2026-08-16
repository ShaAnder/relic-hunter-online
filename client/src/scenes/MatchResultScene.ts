import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import type { HunterScoreEntry } from "@/core/game/GameSession";
import { Button } from "@/ui/generics/Button";
import { LobbyScene } from "./LobbyScene";

/** One row of the scoreboard — a label plus how to pull that metric's number out of a hunter's score. */
interface ScoreRow {
	label: string;
	getValue: (entry: HunterScoreEntry) => number;
}

const SCORE_ROWS: ScoreRow[] = [
	{ label: "Damage Dealt", getValue: (e) => e.matchScore.damageDealt },
	{ label: "Items Owned", getValue: (e) => e.matchScore.itemsScore },
	{ label: "Cards Remaining", getValue: (e) => e.matchScore.cardsRemaining },
	{ label: "Environmental", getValue: (e) => e.matchScore.environmentalScore },
	{ label: "Tactical", getValue: (e) => e.matchScore.tacticalScore },
	{ label: "Objective", getValue: (e) => e.matchScore.objectiveTurnsHeld },
];

const COLUMN_WIDTH = 170;
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 90;
const ICON_RADIUS = 24;

/**
 * Full-match scoreboard — a row per scoring metric, a column per hunter.
 * Every hunter shown, not just the local one; whichever fields aren't
 * wired to real gameplay yet just show their current (often zero, or a
 * flat starting value)
 * @author ShaAnder
 */
export class MatchResultScene implements Scene {
	readonly view = new Container();

	private headline!: Text;
	private grid = new Container();
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

		this.view.addChild(this.grid);
		if (result && result.hunterScores.length > 0) {
			this.buildGrid(result.hunterScores);
		} else {
			const fallback = new Text({
				text: "No match data — did you get here directly?",
				style: { fill: 0xffffff, fontSize: 18 },
			});
			this.grid.addChild(fallback);
		}

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

	private buildGrid(hunters: HunterScoreEntry[]): void {
		// Row labels down the left edge
		const labelColumn = new Container();
		labelColumn.y = HEADER_HEIGHT;
		for (let r = 0; r < SCORE_ROWS.length; r++) {
			const label = new Text({
				text: SCORE_ROWS[r].label,
				style: { fill: 0xaaaaaa, fontSize: 14 },
			});
			label.y = r * ROW_HEIGHT;
			labelColumn.addChild(label);
		}
		const totalLabel = new Text({
			text: "Total",
			style: { fill: 0xffd700, fontSize: 16, fontWeight: "bold" },
		});
		totalLabel.y = SCORE_ROWS.length * ROW_HEIGHT + 10;
		labelColumn.addChild(totalLabel);
		this.grid.addChild(labelColumn);

		const labelColumnWidth = 130;

		for (let c = 0; c < hunters.length; c++) {
			const hunter = hunters[c];
			const columnX = labelColumnWidth + c * COLUMN_WIDTH;

			const icon = new Graphics();
			icon.circle(0, 0, ICON_RADIUS);
			icon.fill(hunter.accentColor);
			icon.stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
			icon.x = columnX + COLUMN_WIDTH / 2;
			icon.y = ICON_RADIUS;
			this.grid.addChild(icon);

			const name = new Text({
				text: hunter.label,
				style: { fill: 0xffffff, fontSize: 13, fontWeight: "bold" },
			});
			name.anchor.set(0.5, 0);
			name.x = columnX + COLUMN_WIDTH / 2;
			name.y = ICON_RADIUS * 2 + 8;
			this.grid.addChild(name);

			let total = 0;
			for (let r = 0; r < SCORE_ROWS.length; r++) {
				const value = SCORE_ROWS[r].getValue(hunter);
				total += value;
				const valueText = new Text({
					text: `${value}`,
					style: { fill: 0xffffff, fontSize: 14 },
				});
				valueText.anchor.set(0.5, 0);
				valueText.x = columnX + COLUMN_WIDTH / 2;
				valueText.y = HEADER_HEIGHT + r * ROW_HEIGHT;
				this.grid.addChild(valueText);
			}

			const totalText = new Text({
				text: `${total}`,
				style: { fill: 0xffd700, fontSize: 18, fontWeight: "bold" },
			});
			totalText.anchor.set(0.5, 0);
			totalText.x = columnX + COLUMN_WIDTH / 2;
			totalText.y = HEADER_HEIGHT + SCORE_ROWS.length * ROW_HEIGHT + 8;
			this.grid.addChild(totalText);
		}
	}

	/** Clear the consumed result so a stale one can't leak into the next match. */
	private onReturnToLobby(): void {
		this.game.session.matchResult = null;
		void this.game.sceneManager.changeScene(new LobbyScene(this.game));
	}

	private layout(width: number, height: number): void {
		this.headline.x = width / 2 - this.headline.width / 2;
		this.headline.y = height * 0.08;

		this.grid.x = width / 2 - this.grid.width / 2;
		this.grid.y = height * 0.2;

		this.returnBtn.view.x = width / 2 - 110;
		this.returnBtn.view.y = height * 0.88;
	}
}
