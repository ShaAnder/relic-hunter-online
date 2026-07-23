import { Container, Graphics, Text } from "pixi.js";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import { Hand, SKIP_CARD_ID } from "@/ui/Hand";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import type {
	CardData,
	CardColor,
	CombatAction,
	CombatChoice,
	MercenaryState,
} from "@relic-hunter/shared";
import {
	resolveCombatRound,
	resolveDefeat,
	resolveSurrender,
} from "@relic-hunter/shared";

/** Card colors each action allows. */
const ALLOWED_COLORS: Record<CombatAction, CardColor[]> = {
	attack: ["red", "yellow", "blue"],
	defend: ["yellow"],
	run: ["blue", "yellow"],
	surrender: [],
};

const ACTIONS: CombatAction[] = ["attack", "defend", "run", "surrender"];
const ACTION_LABELS: Record<CombatAction, string> = {
	attack: "Attack",
	defend: "Defend",
	run: "Run",
	surrender: "Surrender",
};

const RESULT_LINGER_MS = 2200;
// Real map tile size — same coordinate math as MapScene, so a future
// run/attack animation can reuse Mercenary's moveAlongPath against these
// grid coords unchanged.
const ARENA_COLS = 15;
const ARENA_ROWS = 7;
const MID_ROW = Math.floor(ARENA_ROWS / 2);

// Both combatants on the middle row, one tile in from each edge — not
// opposite corners, facing each other along the center line.
const PLAYER_TILE = { x: 1, y: MID_ROW };
const ENEMY_TILE = { x: ARENA_COLS - 2, y: MID_ROW };

export interface BattleResult {
	enemyDefeated: boolean;
	playerNeedsTeleport: boolean;
}

/**
 * Iso arena combat overlay, layered on MapScene via OverlayManager. Both
 * combatants stand at opposite corners of an asymmetrical iso grid; the
 * player picks an action via a cycling selector above their own token.
 * @param game - active Game instance
 * @param playerState - player's live combat state
 * @param enemyState - enemy's live combat state
 * @param onComplete - fired once the round resolves and the overlay hides
 * @author ShaAnder
 */
export class BattleOverlay implements Overlay {
	readonly view = new Container();

	private backdrop = new Graphics();
	private arena = new Container();

	private playerPanel = new Container();
	private enemyPanel = new Container();
	private playerHpBar = new Graphics();
	private enemyHpBar = new Graphics();
	private playerHpText!: Text;
	private enemyHpText!: Text;

	private roundText!: Text;
	private enemyIndicator!: Text;

	// Action selector — cycles through ACTIONS, confirms on center-label click
	private selectorContainer = new Container();
	private selectorIndex = 0;
	private selectorLabel!: Text;

	// Real Hand component — same fan/caret/selection logic as the overworld,
	// not a separate ad-hoc picker. Card confirmation always resolves
	// whatever action is currently pending.
	private playerHand: Hand = new Hand((card) => this.onHandCardConfirmed(card));
	private pendingAction: CombatAction | null = null;

	private resolved = false;

	constructor(
		private game: Game,
		private playerState: MercenaryState,
		private enemyState: MercenaryState,
		private onComplete: (result: BattleResult) => void,
	) {}

	onShow(): void {
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onHide(): void {
		this.playerHand.exitSelectionMode();
	}

	update(deltaTime: number): void {
		this.playerHand.update(deltaTime);
	}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	// ---------- UI construction ----------

	private buildUI(): void {
		this.backdrop.eventMode = "static"; // blocks clicks to MapScene underneath
		this.view.addChild(this.backdrop);
		this.view.addChild(this.arena);

		this.buildArenaGrid();
		this.buildCombatantTokens();
		this.buildCornerPanels();
		this.buildEnemyIndicator();
		this.buildActionSelector();

		// Added last so it renders above the arena/panels — real Hand
		// component, own bottom-center anchor, same as the overworld
		this.view.addChild(this.playerHand.view);
		this.playerHand.syncFromHand(this.playerState.hand);

		this.roundText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 18, fontWeight: "bold" },
		});
		this.roundText.anchor.set(0.5);
		this.roundText.y = -150;
		this.arena.addChild(this.roundText);

		this.syncHpDisplay();
	}

	/** Iso projection for an arena grid coord, centered so the whole grid sits around (0,0). */
	/** Same projection MapScene uses, just centered so the grid sits around (0,0). */
	private arenaGridToScreen(gx: number, gy: number): { x: number; y: number } {
		return gridToScreen({
			x: gx - (ARENA_COLS - 1) / 2,
			y: gy - (ARENA_ROWS - 1) / 2,
		});
	}

	/** Draws the full arena floor, every tile in the grid. */
	private buildArenaGrid(): void {
		const tileLayer = new Container();
		for (let gx = 0; gx < ARENA_COLS; gx++) {
			for (let gy = 0; gy < ARENA_ROWS; gy++) {
				const pos = this.arenaGridToScreen(gx, gy);
				const tile = new Graphics();
				tile.poly([
					0,
					-TILE_HEIGHT / 2,
					TILE_WIDTH / 2,
					0,
					0,
					TILE_HEIGHT / 2,
					-TILE_WIDTH / 2,
					0,
				]);
				tile.fill(0x3a3a3a);
				tile.stroke({ width: 1, color: 0x000000, alpha: 0.4 });
				tile.x = pos.x;
				tile.y = pos.y;
				tileLayer.addChild(tile);
			}
		}
		this.arena.addChild(tileLayer);
	}

	/** Sphere tokens at opposite corners of the grid. */
	private buildCombatantTokens(): void {
		const playerPos = this.arenaGridToScreen(PLAYER_TILE.x, PLAYER_TILE.y);
		const playerToken = new Graphics();
		playerToken.circle(0, 0, 20);
		playerToken.fill(0x4a9eff);
		playerToken.x = playerPos.x;
		playerToken.y = playerPos.y - 14;
		this.arena.addChild(playerToken);

		const enemyPos = this.arenaGridToScreen(ENEMY_TILE.x, ENEMY_TILE.y);
		const enemyToken = new Graphics();
		enemyToken.circle(0, 0, 20);
		enemyToken.fill(0xe67e22);
		enemyToken.x = enemyPos.x;
		enemyToken.y = enemyPos.y - 14;
		this.arena.addChild(enemyToken);
	}

	/** Bottom-left/right stat panels: name, Mv/At/Df row, HP number + bar. */
	private buildCornerPanels(): void {
		this.buildOnePanel(
			this.playerPanel,
			this.playerHpBar,
			"You",
			this.playerState,
			0x4a9eff,
		);
		this.buildOnePanel(
			this.enemyPanel,
			this.enemyHpBar,
			"Enemy",
			this.enemyState,
			0xe67e22,
		);
		this.view.addChild(this.playerPanel);
		this.view.addChild(this.enemyPanel);
	}

	private buildOnePanel(
		panel: Container,
		hpBar: Graphics,
		label: string,
		state: MercenaryState,
		accent: number,
	): void {
		const bg = new Graphics();
		bg.roundRect(0, 0, 190, 100, 8);
		bg.fill({ color: 0x1a1a1a, alpha: 0.9 });
		bg.stroke({ width: 2, color: accent });
		panel.addChild(bg);

		const nameText = new Text({
			text: label,
			style: { fill: accent, fontSize: 16, fontWeight: "bold" },
		});
		nameText.x = 10;
		nameText.y = 8;
		panel.addChild(nameText);

		const statText = new Text({
			text: `Mv ${state.stats.movement}  At ${state.stats.attack}  Df ${state.stats.defense}`,
			style: { fill: 0xcccccc, fontSize: 12 },
		});
		statText.x = 10;
		statText.y = 32;
		panel.addChild(statText);

		const hpText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 13 },
		});
		hpText.x = 10;
		hpText.y = 54;
		panel.addChild(hpText);
		if (label === "You") this.playerHpText = hpText;
		else this.enemyHpText = hpText;

		hpBar.x = 10;
		hpBar.y = 76;
		panel.addChild(hpBar);
	}

	private syncHpDisplay(): void {
		this.syncOneHpBar(
			this.playerHpText,
			this.playerHpBar,
			this.playerState,
			0x2ecc71,
		);
		this.syncOneHpBar(
			this.enemyHpText,
			this.enemyHpBar,
			this.enemyState,
			0x2ecc71,
		);
	}

	private syncOneHpBar(
		text: Text,
		bar: Graphics,
		state: MercenaryState,
		fillColor: number,
	): void {
		const hp = Math.max(0, state.currentHp);
		const max = state.stats.maxHp;
		text.text = `${hp} / ${max} HP`;

		const ratio = max > 0 ? hp / max : 0;
		bar.clear();
		bar.rect(0, 0, 170, 10);
		bar.fill(0x333333);
		bar.rect(0, 0, 170 * ratio, 10);
		bar.fill(ratio > 0.3 ? fillColor : 0xe74c3c);
	}

	/** "?" placeholder above the enemy until their choice is revealed at resolution. */
	private buildEnemyIndicator(): void {
		const pos = this.arenaGridToScreen(ENEMY_TILE.x, ENEMY_TILE.y);
		this.enemyIndicator = new Text({
			text: "?",
			style: { fill: 0xffffff, fontSize: 24, fontWeight: "bold" },
		});
		this.enemyIndicator.anchor.set(0.5);
		this.enemyIndicator.x = pos.x;
		this.enemyIndicator.y = pos.y - 70;
		this.arena.addChild(this.enemyIndicator);
	}

	/** "< Action >" cycling selector above the player's token. Click the label to confirm. */
	private buildActionSelector(): void {
		const pos = this.arenaGridToScreen(PLAYER_TILE.x, PLAYER_TILE.y);
		this.selectorContainer.x = pos.x;
		this.selectorContainer.y = pos.y - 70;
		this.arena.addChild(this.selectorContainer);

		const leftArrow = this.buildArrow("◀", () => this.cycleSelector(-1));
		leftArrow.x = -55;
		this.selectorContainer.addChild(leftArrow);

		const rightArrow = this.buildArrow("▶", () => this.cycleSelector(1));
		rightArrow.x = 55;
		this.selectorContainer.addChild(rightArrow);

		this.selectorLabel = new Text({
			text: ACTION_LABELS[ACTIONS[this.selectorIndex]],
			style: { fill: 0xffd700, fontSize: 16, fontWeight: "bold" },
		});
		this.selectorLabel.anchor.set(0.5);
		this.selectorLabel.eventMode = "static";
		this.selectorLabel.cursor = "pointer";
		this.selectorLabel.on("pointerdown", () => this.confirmSelector());
		this.selectorContainer.addChild(this.selectorLabel);
	}

	private buildArrow(symbol: string, onClick: () => void): Text {
		const t = new Text({
			text: symbol,
			style: { fill: 0xffffff, fontSize: 18 },
		});
		t.anchor.set(0.5);
		t.eventMode = "static";
		t.cursor = "pointer";
		t.on("pointerdown", onClick);
		return t;
	}

	private cycleSelector(direction: 1 | -1): void {
		this.selectorIndex =
			(this.selectorIndex + direction + ACTIONS.length) % ACTIONS.length;
		this.selectorLabel.text = ACTION_LABELS[ACTIONS[this.selectorIndex]];
	}

	// ---------- Action selection ----------

	/** Surrender skips the card picker entirely — never involves a card. */
	private confirmSelector(): void {
		const action = ACTIONS[this.selectorIndex];
		this.selectorContainer.visible = false;

		if (action === "surrender") {
			this.resolveRound({ action, stats: this.playerState.stats });
			return;
		}

		this.pendingAction = action;
		const allowedColors = ALLOWED_COLORS[action];
		this.playerHand.enterSelectionMode((data) =>
			allowedColors.includes(data.color),
		);
		this.roundText.text = `Choose a card for ${ACTION_LABELS[action]}`;
	}

	/**
	 * Fires when the player confirms a card in playerHand — same callback
	 * shape MapScene uses for its own hand. Resolves whichever action is
	 * currently pending; "No Card" (Hand's built-in skip option) resolves
	 * with no card, same as choosing not to play one.
	 */
	private onHandCardConfirmed(card: CardData): void {
		if (!this.pendingAction) return;
		const chosenCard = card.id === SKIP_CARD_ID ? undefined : card;
		this.resolveRound({
			action: this.pendingAction,
			stats: this.playerState.stats,
			card: chosenCard,
		});
		this.pendingAction = null;
	}

	// ---------- Resolution ----------

	/** Enemy's choice — random Attack/Defend, no card. Stand-in until real AI lands. */
	private chooseEnemyAction(): CombatChoice {
		const action: CombatAction = Math.random() < 0.5 ? "attack" : "defend";
		return { action, stats: this.enemyState.stats };
	}

	private resolveRound(playerChoice: CombatChoice): void {
		if (this.resolved) return;
		this.resolved = true;

		if (playerChoice.card) {
			const idx = this.playerState.hand.findIndex(
				(c) => c.id === playerChoice.card!.id,
			);
			if (idx !== -1) this.playerState.hand.splice(idx, 1);
		}

		const enemyChoice = this.chooseEnemyAction();
		const result = resolveCombatRound(playerChoice, enemyChoice);

		this.playerState.currentHp -= result.a.damageTaken;
		this.enemyState.currentHp -= result.b.damageTaken;
		this.syncHpDisplay();

		this.enemyIndicator.text = ACTION_LABELS[enemyChoice.action];

		this.roundText.text = this.describeOutcome(
			playerChoice,
			result.a,
			result.b,
		);

		this.finishBattle(playerChoice);
	}

	private describeOutcome(
		playerChoice: CombatChoice,
		playerOutcome: {
			damageTaken: number;
			nullified: boolean;
			escaped?: boolean;
			itemGiven?: boolean;
		},
		enemyOutcome: { damageTaken: number },
	): string {
		if (playerChoice.action === "surrender") return "You surrendered.";
		if (playerChoice.action === "run") {
			return playerOutcome.escaped
				? "You escaped!"
				: `Caught! Took ${playerOutcome.damageTaken} damage.`;
		}
		return `You dealt ${enemyOutcome.damageTaken} and took ${playerOutcome.damageTaken}.`;
	}

	/** Apply round consequences to shared state, then report what MapScene needs to do. */
	private finishBattle(playerChoice: CombatChoice): void {
		let playerNeedsTeleport = false;
		let enemyDefeated = false;

		if (playerChoice.action === "surrender") {
			const consequence = resolveSurrender(this.playerState.items.length);
			if (consequence.itemGiven) {
				// Takes the first item for now — a real item-picker is a follow-up
				const given = this.playerState.items.shift();
				if (given) this.enemyState.items.push(given);
			}
			playerNeedsTeleport = true;
		} else {
			if (this.playerState.currentHp <= 0) {
				const consequence = resolveDefeat(this.playerState.stats, true);
				this.playerState.currentHp = consequence.hpCeiling;
				if (consequence.itemStolen && this.playerState.items.length > 0) {
					const stolen = this.playerState.items.shift();
					if (stolen) this.enemyState.items.push(stolen);
				}
				playerNeedsTeleport = true;
			}

			if (this.enemyState.currentHp <= 0) {
				enemyDefeated = true;
			}
		}

		setTimeout(() => {
			this.game.overlays.hide();
			this.onComplete({ enemyDefeated, playerNeedsTeleport });
		}, RESULT_LINGER_MS);
	}

	// ---------- Layout ----------

	private layout(width: number, height: number): void {
		this.backdrop.clear();
		this.backdrop.rect(0, 0, width, height);
		this.backdrop.fill({ color: 0x000000, alpha: 1 }); // fully opaque — MapScene hidden, not dimmed

		this.arena.x = width / 2;
		this.arena.y = height / 2 - 30;

		this.playerPanel.x = 24;
		this.playerPanel.y = height - 124;

		this.enemyPanel.x = width - 214;
		this.enemyPanel.y = height - 124;

		this.playerHand.resize(width, height);
	}
}
