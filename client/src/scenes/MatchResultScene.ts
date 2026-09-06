import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import type { HunterScoreEntry } from "@/core/game/GameSession";
import { Button } from "@/ui/generics/Button";
import { computeFitScale } from "@/math/fitScale";
import { CharacterSprite } from "@/entities/CharacterSprite";
import { toSpriteCharacterClass } from "@/types/characterSprite";
import { LobbyScene } from "./LobbyScene";

/** One row of the scoreboard — a label plus how to pull that metric's number out of a hunter's score. */
interface ScoreRow {
	label: string;
	getValue: (entry: HunterScoreEntry) => number;
}

const SCORE_ROWS: ScoreRow[] = [
	{ label: "Damage Dealt", getValue: (e) => e.matchScore.damageDealt * 1000 },
	{ label: "Items Owned", getValue: (e) => e.matchScore.itemsScore },
	{ label: "Cards Remaining", getValue: (e) => e.matchScore.cardsRemaining },
	{ label: "Environmental", getValue: (e) => e.matchScore.environmentalScore },
	{ label: "Tactical", getValue: (e) => e.matchScore.tacticalScore },
];

const COLUMN_WIDTH = 170;
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;
const SPRITE_ROW_HEIGHT = 90;
/** How fast a displayed number closes the gap to its real target each second — a fraction of the remaining distance, not a fixed step, so big and small gaps both settle in about the same time. */
const COUNT_SPEED_PER_SEC = 3.5;

/** One animated number display — current is what's shown, target is the real score value it's converging toward. */
interface Counter {
	text: Text;
	current: number;
	target: number;
}

/** A hunter's sprite plus its final total — needed to rank hunters once counting finishes. */
interface RankedSprite {
	sprite: CharacterSprite;
	total: number;
}

/**
 * Full-match scoreboard — a row per scoring metric, a column per hunter.
 * Every hunter shown, not just the local one; whichever fields aren't
 * wired to real gameplay yet just show their current (often zero, or a
 * flat starting value). Numbers animate in by counting up/down toward
 * their real value rather than snapping in instantly, and each
 * column's own hunter is shown as their actual character sprite,
 * walking in place, rather than a generic colored icon.
 * @author ShaAnder
 */
export class MatchResultScene implements Scene {
	readonly view = new Container();
	private content = new Container();

	private headline!: Text;
	private grid = new Container();
	private returnBtn!: Button;
	private counters: Counter[] = [];
	private rankedSprites: RankedSprite[] = [];
	/** Set once rank-based animations have fired, so it only happens the one time counting finishes, not every frame after. */
	private outcomeApplied = false;

	private readonly DESIGN_WIDTH = 900;
	private readonly DESIGN_HEIGHT = 600;

	constructor(private game: Game) {}

	onEnter(): void {
		this.game.audio.playMusic("end");
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onExit(): void {}

	update(deltaTime: number): void {
		// deltaTime here is Pixi ticker units (~1 at 60fps), not raw ms —
		// convert to seconds so COUNT_SPEED_PER_SEC means what it says
		// regardless of the actual frame rate.
		const dtSeconds = deltaTime / 60;
		let allSettled = true;
		for (const counter of this.counters) {
			const diff = counter.target - counter.current;
			if (Math.abs(diff) < 1) {
				counter.current = counter.target;
			} else {
				counter.current += diff * Math.min(1, COUNT_SPEED_PER_SEC * dtSeconds);
				allSettled = false;
			}
			counter.text.text = `${Math.round(counter.current)}`;
		}
		for (const ranked of this.rankedSprites) {
			ranked.sprite.update(deltaTime);
		}

		// Fires exactly once, the frame every counter first reaches its
		// real value — "when score stops counting," not on scene entry.
		if (allSettled && !this.outcomeApplied && this.rankedSprites.length > 0) {
			this.outcomeApplied = true;
			this.applyRankOutcomes();
		}
	}

	/**
	 * Last place gets the defeat/stagger pose (stunned — no dedicated
	 * "defeated" sprite exists yet, same stand-in used elsewhere),
	 * first place gets victory, everyone in between just settles to
	 * idle instead of continuing to walk in place indefinitely.
	 */
	private applyRankOutcomes(): void {
		const ranked = [...this.rankedSprites].sort((a, b) => b.total - a.total);
		ranked.forEach((entry, i) => {
			if (i === 0) {
				void entry.sprite.playAsync("victory").then(() => {
					void entry.sprite.play("idle");
				});
			} else if (i === ranked.length - 1) {
				void entry.sprite.play("stunned", { loop: true });
			} else {
				void entry.sprite.play("idle");
			}
		});
	}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	private buildUI(): void {
		this.view.addChild(this.content);

		const result = this.game.session.matchResult;

		this.headline = new Text({
			text: result?.won ? "🎉 Extracted!" : "Match Ended",
			style: {
				fill: result?.won ? 0xffd700 : 0xffffff,
				fontSize: 40,
				fontWeight: "bold",
			},
		});
		this.content.addChild(this.headline);

		this.content.addChild(this.grid);
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
		this.content.addChild(this.returnBtn.view);
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

			const name = new Text({
				text: hunter.label,
				style: { fill: 0xffffff, fontSize: 13, fontWeight: "bold" },
			});
			name.anchor.set(0.5, 0);
			name.x = columnX + COLUMN_WIDTH / 2;
			name.y = 0;
			this.grid.addChild(name);

			let targetTotal = 0;
			const totalCounter: Counter = {
				text: new Text({
					text: "0",
					style: { fill: 0xffd700, fontSize: 18, fontWeight: "bold" },
				}),
				current: 0,
				target: 0,
			};

			for (let r = 0; r < SCORE_ROWS.length; r++) {
				const value = SCORE_ROWS[r].getValue(hunter);
				targetTotal += value;

				const valueText = new Text({
					text: "0",
					style: { fill: 0xffffff, fontSize: 14 },
				});
				valueText.anchor.set(0.5, 0);
				valueText.x = columnX + COLUMN_WIDTH / 2;
				valueText.y = HEADER_HEIGHT + r * ROW_HEIGHT;
				this.grid.addChild(valueText);

				this.counters.push({ text: valueText, current: 0, target: value });
			}

			totalCounter.target = targetTotal;
			totalCounter.text.anchor.set(0.5, 0);
			totalCounter.text.x = columnX + COLUMN_WIDTH / 2;
			totalCounter.text.y = HEADER_HEIGHT + SCORE_ROWS.length * ROW_HEIGHT + 8;
			this.grid.addChild(totalCounter.text);
			this.counters.push(totalCounter);

			// Real character sprite, below the total row, walking in
			// place until rank outcomes apply once counting finishes —
			// replaces the old flat colored-circle icon.
			const spriteY =
				HEADER_HEIGHT + SCORE_ROWS.length * ROW_HEIGHT + 40 + SPRITE_ROW_HEIGHT;
			const sprite = new CharacterSprite(
				toSpriteCharacterClass(hunter.characterClass),
			);
			sprite.view.x = columnX + COLUMN_WIDTH / 2;
			sprite.view.y = spriteY;
			this.grid.addChild(sprite.view);
			this.rankedSprites.push({ sprite, total: targetTotal });
			void sprite.init().then((ok) => {
				if (ok) void sprite.play("walk", { loop: true });
			});
		}
	}

	/** Clear the consumed result so a stale one can't leak into the next match. */
	private onReturnToLobby(): void {
		this.game.session.matchResult = null;
		void this.game.sceneManager.changeScene(new LobbyScene(this.game));
	}

	private layout(width: number, height: number): void {
		this.headline.x = this.DESIGN_WIDTH / 2 - this.headline.width / 2;
		this.headline.y = this.DESIGN_HEIGHT * 0.06;

		this.grid.x = this.DESIGN_WIDTH / 2 - this.grid.width / 2;
		this.grid.y = this.DESIGN_HEIGHT * 0.16;

		this.returnBtn.view.x = this.DESIGN_WIDTH / 2 - 110;
		this.returnBtn.view.y = this.DESIGN_HEIGHT * 0.92;

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
