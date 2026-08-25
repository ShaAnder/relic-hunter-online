import { Container, Graphics, Text } from "pixi.js";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import { Hand, SKIP_CARD_ID } from "@/ui/Hand";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import { computeUiScale, uiPx } from "@/math/uiScale";
import { chooseCombatAction } from "@relic-hunter/shared";
import type {
	CardData,
	CardColor,
	CombatAction,
	CombatChoice,
	MercenaryState,
	AiArchetype,
} from "@relic-hunter/shared";
import {
	resolveCombatRound,
	resolveDefeat,
	resolveSurrender,
} from "@relic-hunter/shared";
import { PlayZone } from "@/ui/PlayZone";
import { InventoryPanel } from "@/ui/InventoryPanel";
import {
	decideLootChoice,
	decideSurrenderChoice,
	monsterCombatChoice,
} from "@relic-hunter/shared";

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

// Artificial pacing beats — placeholders standing in for real animation
// timing later. Tuned for "feels deliberate,"
const REVEAL_PAUSE_MS = 600;
const SEQUENTIAL_HIT_GAP_MS = 900;
const POST_DAMAGE_PAUSE_MS = 600;
const BETWEEN_ROUNDS_MS = 800;

const LANDSCAPE_COLS = 15;
const LANDSCAPE_ROWS = 7;
const PORTRAIT_COLS = 7;
const PORTRAIT_ROWS = 15;

export type LocalHumanRole = "attacker" | "defender" | "none";

export interface BattleResult {
	attackerNeedsTeleport: boolean;
	defenderNeedsTeleport: boolean;
	attackerMonsterDied?: boolean;
	defenderMonsterDied?: boolean;
}

/**
 * Iso arena. Orientation and slot assignment both follow the real map
 * direction the fight is happening along — north/south-dominant fights
 * render portrait, east/west render landscape; whoever is south/west
 * gets the near/bottom slot, north/east gets the far/top slot. Grid
 * convention: y = north(-)/south(+), x = west(-)/east(+).
 * @author ShaAnder
 */
export class BattleOverlay implements Overlay {
	readonly view = new Container();
	/** MapScene must not dismiss this overlay on Escape mid-fight. */
	readonly blocksEscape = true;

	private backdrop = new Graphics();
	private arena = new Container();

	private attackerPanel = new Container();
	private defenderPanel = new Container();
	private attackerHpBar = new Graphics();
	private defenderHpBar = new Graphics();
	private attackerHpText!: Text;
	private defenderHpText!: Text;

	private roundText!: Text;
	private attackerIndicator?: Text;
	private defenderIndicator?: Text;

	private attackerStatText!: Text;
	private defenderStatText!: Text;

	private selectorContainer = new Container();
	private selectorIndex = 0;
	private selectorLabel!: Text;

	private localHand!: Hand;
	private localPlayZone = new PlayZone();
	private pendingAction: CombatAction | null = null;

	// combat resolution - rounds
	private currentRound = 1;
	private roundInProgress = false;
	private roundCounterText!: Text;

	private arenaCols: number;
	private arenaRows: number;
	private nearTile: { x: number; y: number };
	private farTile: { x: number; y: number };
	private attackerNear: boolean;

	private winnerLootPanel = new InventoryPanel();
	private loserLootPanel = new InventoryPanel();
	private surrenderLootPanel = new InventoryPanel();
	private lootConfirmPopup = new Container();
	private lootConfirmBg = new Graphics();
	private lootConfirmText!: Text;
	private lootSkipLabel!: Text;
	private pendingLootIndex: number | null = null;
	private lootResolve: (() => void) | null = null;
	private allowLootSkip = false;
	private currentWinnerState: MercenaryState | null = null;
	private currentLoserState: MercenaryState | null = null;

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	constructor(
		private game: Game,
		private attackerState: MercenaryState,
		private defenderState: MercenaryState,
		private onComplete: (result: BattleResult) => void,
		private attackerColor: number,
		private attackerLabel: string,
		private defenderColor: number,
		private defenderLabel: string,
		private attackerArchetype: AiArchetype = "balanced",
		private defenderArchetype: AiArchetype = "balanced",
		private localHumanRole: LocalHumanRole = "attacker",
		attackerMapCoord: { x: number; y: number },
		defenderMapCoord: { x: number; y: number },
		private isRangedInitiated: boolean = false,
		private availableActions: CombatAction[] = ACTIONS,
		private isAttackerMonster: boolean = false,
		private isDefenderMonster: boolean = false,
		private readonly maxRounds: number = 3,
	) {
		this.localHand = new Hand(this.game.app.stage, this.localPlayZone, (card) =>
			this.onHandCardConfirmed(card),
		);

		const dx = attackerMapCoord.x - defenderMapCoord.x;
		const dy = attackerMapCoord.y - defenderMapCoord.y;
		const isNorthSouth = Math.abs(dy) >= Math.abs(dx);

		const attackerScreen = gridToScreen(attackerMapCoord);
		const defenderScreen = gridToScreen(defenderMapCoord);

		if (isNorthSouth) {
			this.arenaCols = PORTRAIT_COLS;
			this.arenaRows = PORTRAIT_ROWS;
			const midCol = Math.floor(this.arenaCols / 2);
			this.nearTile = { x: midCol, y: this.arenaRows - 2 };
			this.farTile = { x: midCol, y: 1 };
			this.attackerNear = attackerScreen.y >= defenderScreen.y;
		} else {
			this.arenaCols = LANDSCAPE_COLS;
			this.arenaRows = LANDSCAPE_ROWS;
			const midRow = Math.floor(this.arenaRows / 2);
			this.nearTile = { x: this.arenaCols - 2, y: midRow };
			this.farTile = { x: 1, y: midRow };
			this.attackerNear = attackerScreen.x >= defenderScreen.x;
		}
	}

	onShow(): void {
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onHide(): void {
		this.localHand.exitSelectionMode();
		this.winnerLootPanel.view.visible = false;
		this.loserLootPanel.view.visible = false;
		this.surrenderLootPanel.view.visible = false;
		this.lootConfirmPopup.visible = false;
		this.pendingLootIndex = null;
		this.lootResolve?.();
		this.lootResolve = null;
		this.loserLootPanel.setOnTake(() => {});
		this.surrenderLootPanel.setOnGive(() => {});
	}

	update(deltaTime: number): void {
		this.localHand.update(deltaTime);
		this.localPlayZone.update(deltaTime);
		this.winnerLootPanel.update(deltaTime);
		this.loserLootPanel.update(deltaTime);
		this.surrenderLootPanel.update(deltaTime);
	}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	private attackerTile(): { x: number; y: number } {
		return this.attackerNear ? this.nearTile : this.farTile;
	}

	private defenderTile(): { x: number; y: number } {
		return this.attackerNear ? this.farTile : this.nearTile;
	}

	private allowedActionsFor(role: "attacker" | "defender"): CombatAction[] {
		let actions = ACTIONS;
		if (role === "defender" && this.isRangedInitiated) {
			actions = actions.filter((a) => a !== "attack");
		}
		const opponentIsMonster =
			role === "attacker" ? this.isDefenderMonster : this.isAttackerMonster;
		if (opponentIsMonster) {
			actions = actions.filter((a) => a !== "surrender");
		}
		return actions;
	}

	private async runAutoFight(): Promise<void> {
		await this.delay(700);
		if (this.roundInProgress) return;
		const attackerChoice = this.isAttackerMonster
			? monsterCombatChoice(this.attackerState.stats)
			: chooseCombatAction(
					this.attackerState.hand,
					this.attackerState.stats,
					this.attackerArchetype,
					{
						currentHp: this.attackerState.currentHp,
						opponentStats: this.defenderState.stats,
						canAttack: true,
						againstMonster: this.isDefenderMonster,
						committed: true,
						itemCount: this.attackerState.items.filter((i) => i !== null)
							.length,
					},
				);
		const defenderChoice = this.isDefenderMonster
			? monsterCombatChoice(this.defenderState.stats, !this.isRangedInitiated)
			: chooseCombatAction(
					this.defenderState.hand,
					this.defenderState.stats,
					this.defenderArchetype,
					{
						currentHp: this.defenderState.currentHp,
						opponentStats: this.attackerState.stats,
						canAttack: !this.isRangedInitiated,
						againstMonster: this.isAttackerMonster,
						committed: false,
						itemCount: this.defenderState.items.filter((i) => i !== null)
							.length,
					},
				);
		void this.resolveRound(attackerChoice, defenderChoice);
	}

	private buildUI(): void {
		this.backdrop.eventMode = "static";
		this.view.addChild(this.backdrop);
		this.view.addChild(this.arena);

		this.buildArenaGrid();
		this.buildCombatantTokens();
		this.buildCornerPanels();

		this.buildLootPanels();
		this.buildLootConfirmPopup();
		// Confirm lives on view (above panels), never on arena
		this.view.addChild(this.lootConfirmPopup);
		this.lootConfirmPopup.eventMode = "static";

		this.view.addChild(this.localPlayZone.view);

		if (this.localHumanRole === "none") {
			this.buildAttackerIndicator();
			this.buildDefenderIndicator();
		} else if (this.localHumanRole === "attacker") {
			this.buildDefenderIndicator();
			this.buildActionSelector(this.attackerTile(), "attacker");
			this.view.addChild(this.localHand.view);
			this.localHand.syncFromHand(this.attackerState.hand);
		} else {
			this.buildAttackerIndicator();
			this.buildActionSelector(this.defenderTile(), "defender");
			this.view.addChild(this.localHand.view);
			this.localHand.syncFromHand(this.defenderState.hand);
		}

		this.roundText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 18, fontWeight: "bold" },
		});
		this.roundText.anchor.set(0.5);
		this.roundText.y = -150;
		this.arena.addChild(this.roundText);

		this.roundCounterText = new Text({
			text: `Round ${this.currentRound} / ${this.maxRounds}`,
			style: { fill: 0xcccccc, fontSize: 14 },
		});
		this.roundCounterText.anchor.set(0.5);
		this.roundCounterText.y = -180;
		this.arena.addChild(this.roundCounterText);

		this.syncHpDisplay();
		this.syncStatDisplay();

		if (this.localHumanRole === "none") {
			void this.runAutoFight();
		}
	}

	private buildLootPanels(): void {
		this.winnerLootPanel.setOnDrop((index) => {
			if (!this.currentWinnerState) return;
			this.currentWinnerState.items[index] = null;
			this.winnerLootPanel.sync(this.currentWinnerState.items);
		});
		this.winnerLootPanel.view.visible = false;
		this.loserLootPanel.view.visible = false;
		this.surrenderLootPanel.view.visible = false;
		this.view.addChild(this.winnerLootPanel.view);
		this.view.addChild(this.loserLootPanel.view);
		this.view.addChild(this.surrenderLootPanel.view);
	}

	private buildLootConfirmPopup(): void {
		this.lootConfirmBg.roundRect(-100, -50, 200, 100, 8);
		this.lootConfirmBg.fill({ color: 0x111111, alpha: 0.97 });
		this.lootConfirmPopup.addChild(this.lootConfirmBg);

		this.lootConfirmText = new Text({
			text: "Take this item?",
			style: { fill: 0xffffff, fontSize: 14, fontWeight: "bold" },
		});
		this.lootConfirmText.anchor.set(0.5);
		this.lootConfirmText.y = -25;
		this.lootConfirmPopup.addChild(this.lootConfirmText);

		this.lootConfirmPopup.addChild(
			this.buildTextButton("Yes", 0x2ecc71, -50, 5, () =>
				this.resolveLootConfirm(true),
			),
		);
		this.lootConfirmPopup.addChild(
			this.buildTextButton("No", 0xe74c3c, 50, 5, () =>
				this.resolveLootConfirm(false),
			),
		);

		this.lootSkipLabel = new Text({
			text: "Skip taking an item »",
			style: { fill: 0x999999, fontSize: 11 },
		});
		this.lootSkipLabel.anchor.set(0.5);
		this.lootSkipLabel.y = 35;
		this.lootSkipLabel.eventMode = "static";
		this.lootSkipLabel.cursor = "pointer";
		this.lootSkipLabel.on("pointerdown", () => this.resolveLootSkip());
		this.lootConfirmPopup.addChild(this.lootSkipLabel);

		this.lootConfirmPopup.visible = false;
		// Do NOT add to arena — parent is this.view in buildUI
	}

	private buildTextButton(
		label: string,
		color: number,
		x: number,
		y: number,
		onClick: () => void,
	): Text {
		const t = new Text({
			text: label,
			style: { fill: color, fontSize: 16, fontWeight: "bold" },
		});
		t.anchor.set(0.5);
		t.x = x;
		t.y = y;
		t.eventMode = "static";
		t.cursor = "pointer";
		t.on("pointerdown", onClick);
		return t;
	}

	private arenaGridToScreen(gx: number, gy: number): { x: number; y: number } {
		return gridToScreen({
			x: gx - (this.arenaCols - 1) / 2,
			y: gy - (this.arenaRows - 1) / 2,
		});
	}

	private buildArenaGrid(): void {
		const tileLayer = new Container();
		for (let gx = 0; gx < this.arenaCols; gx++) {
			for (let gy = 0; gy < this.arenaRows; gy++) {
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

	private buildCombatantTokens(): void {
		const attackerPos = this.arenaGridToScreen(
			this.attackerTile().x,
			this.attackerTile().y,
		);
		const attackerToken = new Graphics();
		attackerToken.circle(0, 0, 20);
		attackerToken.fill(this.attackerColor);
		attackerToken.x = attackerPos.x;
		attackerToken.y = attackerPos.y - 14;
		this.arena.addChild(attackerToken);

		const defenderPos = this.arenaGridToScreen(
			this.defenderTile().x,
			this.defenderTile().y,
		);
		const defenderToken = new Graphics();
		defenderToken.circle(0, 0, 20);
		defenderToken.fill(this.defenderColor);
		defenderToken.x = defenderPos.x;
		defenderToken.y = defenderPos.y - 14;
		this.arena.addChild(defenderToken);
	}

	private buildCornerPanels(): void {
		this.buildOnePanel(
			this.attackerPanel,
			this.attackerHpBar,
			this.attackerLabel,

			this.attackerColor,
			true,
		);
		this.buildOnePanel(
			this.defenderPanel,
			this.defenderHpBar,
			this.defenderLabel,

			this.defenderColor,
			false,
		);
		this.view.addChild(this.attackerPanel);
		this.view.addChild(this.defenderPanel);
	}

	private buildOnePanel(
		panel: Container,
		hpBar: Graphics,
		label: string,
		accent: number,
		isAttackerSlot: boolean,
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
			text: "",
			style: { fill: 0xcccccc, fontSize: 12 },
		});
		statText.x = 10;
		statText.y = 32;
		panel.addChild(statText);
		if (isAttackerSlot) this.attackerStatText = statText;
		else this.defenderStatText = statText;

		const hpText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 13 },
		});
		hpText.x = 10;
		hpText.y = 54;
		panel.addChild(hpText);
		if (isAttackerSlot) this.attackerHpText = hpText;
		else this.defenderHpText = hpText;

		hpBar.x = 10;
		hpBar.y = 76;
		panel.addChild(hpBar);
	}

	private syncHpDisplay(): void {
		this.syncOneHpBar(
			this.attackerHpText,
			this.attackerHpBar,
			this.attackerState,
			0x2ecc71,
		);
		this.syncOneHpBar(
			this.defenderHpText,
			this.defenderHpBar,
			this.defenderState,
			0x2ecc71,
		);
	}

	private syncStatDisplay(): void {
		this.syncOneStatText(this.attackerStatText, this.attackerState);
		this.syncOneStatText(this.defenderStatText, this.defenderState);
	}

	private syncOneStatText(text: Text, state: MercenaryState): void {
		const atk = state.temporaryStatBonus.attack;
		const atkVal =
			atk === "A"
				? state.stats.attack * 2
				: atk === "C"
					? Math.round(state.stats.attack * 1.5)
					: state.stats.attack + atk;

		const def = state.temporaryStatBonus.defense;
		const defVal =
			def === "A"
				? "I"
				: def === "C"
					? Math.round(state.stats.defense * 1.5)
					: state.stats.defense + def;

		text.text = `Mv ${state.stats.movement}  At ${atkVal}  Df ${defVal}`;
	}

	private syncOneHpBar(
		text: Text,
		bar: Graphics,
		state: MercenaryState,
		fillColor: number,
	): void {
		const hp = Math.max(0, state.currentHp);
		const trueMax = Math.max(1, state.stats.maxHp);
		const ceiling = Math.max(1, state.hpCeiling);
		const fillRatio = Math.min(1, hp / trueMax);
		const ceilingRatio = Math.min(1, ceiling / trueMax);

		text.text = `${hp} / ${ceiling} HP`;

		bar.clear();
		bar.rect(0, 0, 170, 10);
		bar.fill(0x333333);
		bar.rect(0, 0, 170 * fillRatio, 10);
		bar.fill(fillRatio > 0.3 ? fillColor : 0xe74c3c);
		if (ceilingRatio < 1) {
			bar.rect(170 * ceilingRatio, 0, 170 * (1 - ceilingRatio), 10);
			bar.fill({ color: 0x000000, alpha: 0.55 });
		}
	}

	private buildAttackerIndicator(): void {
		const pos = this.arenaGridToScreen(
			this.attackerTile().x,
			this.attackerTile().y,
		);
		this.attackerIndicator = new Text({
			text: "?",
			style: { fill: 0xffffff, fontSize: 24, fontWeight: "bold" },
		});
		this.attackerIndicator.anchor.set(0.5);
		this.attackerIndicator.x = pos.x;
		this.attackerIndicator.y = pos.y - 70;
		this.arena.addChild(this.attackerIndicator);
	}

	private buildDefenderIndicator(): void {
		const pos = this.arenaGridToScreen(
			this.defenderTile().x,
			this.defenderTile().y,
		);
		this.defenderIndicator = new Text({
			text: "?",
			style: { fill: 0xffffff, fontSize: 24, fontWeight: "bold" },
		});
		this.defenderIndicator.anchor.set(0.5);
		this.defenderIndicator.x = pos.x;
		this.defenderIndicator.y = pos.y - 70;
		this.arena.addChild(this.defenderIndicator);
	}

	private buildActionSelector(
		tile: { x: number; y: number },
		role: "attacker" | "defender",
	): void {
		this.availableActions = this.allowedActionsFor(role);
		const pos = this.arenaGridToScreen(tile.x, tile.y);
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
			text: ACTION_LABELS[this.availableActions[this.selectorIndex]],
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
			(this.selectorIndex + direction + this.availableActions.length) %
			this.availableActions.length;
		this.selectorLabel.text =
			ACTION_LABELS[this.availableActions[this.selectorIndex]];
	}

	private confirmSelector(): void {
		const action = this.availableActions[this.selectorIndex];
		this.selectorContainer.visible = false;

		const localStats =
			this.localHumanRole === "attacker"
				? this.attackerState.stats
				: this.defenderState.stats;

		if (action === "surrender") {
			void this.resolveLocalChoice({ action, stats: localStats });
			return;
		}

		this.pendingAction = action;
		const allowedColors = ALLOWED_COLORS[action];
		this.localHand.enterSelectionMode((data) =>
			allowedColors.includes(data.color),
		);
		this.roundText.text = `Choose a card for ${ACTION_LABELS[action]}`;
	}

	private onHandCardConfirmed(card: CardData): void {
		if (!this.pendingAction) return;
		const localState =
			this.localHumanRole === "attacker"
				? this.attackerState
				: this.defenderState;
		const chosenCard = card.id === SKIP_CARD_ID ? undefined : card;

		if (this.pendingAction === "attack" && chosenCard) {
			const v = chosenCard.value;
			if (typeof v === "number" || v === "A" || v === "C") {
				localState.temporaryStatBonus.attack = v;
			}
		}
		this.syncStatDisplay();

		void this.resolveLocalChoice({
			action: this.pendingAction,
			stats: localState.stats,
			card: chosenCard,
		});
		this.pendingAction = null;
	}
	/**
	 * Defeat loot: winner takes from loser.
	 * Human uses loserLootPanel + setOnTake. AI auto-picks.
	 */
	private async runLootSequence(
		winnerState: MercenaryState,
		loserState: MercenaryState,
		winnerIsLocal: boolean,
		allowSkip: boolean,
	): Promise<void> {
		if (!loserState.items.some((i) => i !== null)) return;

		this.currentWinnerState = winnerState;
		this.currentLoserState = loserState;
		this.allowLootSkip = allowSkip;
		this.lootSkipLabel.visible = allowSkip;

		this.winnerLootPanel.setMode("own");
		this.loserLootPanel.setMode("lootable");
		this.winnerLootPanel.setInspectAbovePanel(true);
		this.loserLootPanel.setInspectAbovePanel(true);
		this.winnerLootPanel.sync(winnerState.items);
		this.loserLootPanel.sync(loserState.items);

		const winnerIsAttacker = winnerState === this.attackerState;
		const winnerPanel = winnerIsAttacker
			? this.attackerPanel
			: this.defenderPanel;
		const loserPanel = winnerIsAttacker
			? this.defenderPanel
			: this.attackerPanel;
		this.winnerLootPanel.view.x = winnerPanel.x;
		this.winnerLootPanel.view.y = winnerPanel.y - 240;
		this.loserLootPanel.view.x = loserPanel.x;
		this.loserLootPanel.view.y = loserPanel.y - 240;

		this.winnerLootPanel.view.visible = true;
		this.loserLootPanel.view.visible = true;

		if (!winnerIsLocal) {
			await this.delay(1200);
			const targetItemId = this.game.session.chestPlan?.targetItem?.id ?? null;
			const index = decideLootChoice(loserState.items, targetItemId);
			if (index !== null) this.applyLoot(index);
			this.winnerLootPanel.view.visible = false;
			this.loserLootPanel.view.visible = false;
			return;
		}

		await new Promise<void>((resolve) => {
			this.lootResolve = resolve;
			this.loserLootPanel.setOnTake((index) => {
				this.pendingLootIndex = index;
				this.lootConfirmPopup.x = this.game.app.screen.width / 2;
				this.lootConfirmPopup.y = this.game.app.screen.height / 2;
				this.lootConfirmText.text = "Take this item?";
				this.lootConfirmPopup.visible = true;
			});
		});

		this.winnerLootPanel.view.visible = false;
		this.loserLootPanel.view.visible = false;
	}

	/**
	 * Surrender: loser gives one item from their own panel.
	 * Human uses surrenderLootPanel + setOnGive. AI auto-picks.
	 */
	private async runSurrenderGiveSequence(
		giverState: MercenaryState,
		receiverState: MercenaryState,
		giverIsLocal: boolean,
	): Promise<void> {
		if (!giverState.items.some((i) => i !== null)) return;

		this.currentWinnerState = receiverState;
		this.currentLoserState = giverState;

		this.surrenderLootPanel.setMode("surrendering");
		this.surrenderLootPanel.setInspectAbovePanel(true);
		this.surrenderLootPanel.sync(giverState.items);

		const giverIsAttacker = giverState === this.attackerState;
		const giverPanel = giverIsAttacker
			? this.attackerPanel
			: this.defenderPanel;
		this.surrenderLootPanel.view.x = giverPanel.x;
		this.surrenderLootPanel.view.y = giverPanel.y - 240;
		this.surrenderLootPanel.view.visible = true;

		if (!giverIsLocal) {
			await this.delay(1200);
			const targetItemId = this.game.session.chestPlan?.targetItem?.id ?? null;
			const index = decideSurrenderChoice(giverState.items, targetItemId);
			if (index !== null) {
				this.surrenderLootPanel.sync(giverState.items);
				await this.delay(400);
				this.applyLoot(index);
			}
			this.surrenderLootPanel.view.visible = false;
			return;
		}

		this.lootSkipLabel.visible = false;
		await new Promise<void>((resolve) => {
			this.lootResolve = resolve;
			this.surrenderLootPanel.setOnGive((index) => {
				this.pendingLootIndex = index;
				this.lootConfirmPopup.x = this.game.app.screen.width / 2;
				this.lootConfirmPopup.y = this.game.app.screen.height / 2;
				this.lootConfirmText.text = "Give up this item?";
				this.lootConfirmPopup.visible = true;
			});
		});

		this.surrenderLootPanel.view.visible = false;
	}

	private resolveLootConfirm(accept: boolean): void {
		if (this.pendingLootIndex === null) return;
		const index = this.pendingLootIndex;
		this.pendingLootIndex = null;
		this.lootConfirmPopup.visible = false;

		if (!accept) return;

		this.applyLoot(index);
		this.lootResolve?.();
		this.lootResolve = null;
	}

	private resolveLootSkip(): void {
		if (!this.allowLootSkip) return;
		this.lootConfirmPopup.visible = false;
		this.lootResolve?.();
		this.lootResolve = null;
	}

	private applyLoot(index: number): void {
		if (!this.currentWinnerState || !this.currentLoserState) return;
		const item = this.currentLoserState.items[index];
		if (!item) return;

		const emptySlot = this.currentWinnerState.items.findIndex(
			(i) => i === null,
		);
		if (emptySlot === -1) return;

		this.currentLoserState.items[index] = null;
		this.currentWinnerState.items[emptySlot] = item;
		this.winnerLootPanel.sync(this.currentWinnerState.items);
		this.loserLootPanel.sync(this.currentLoserState.items);
		this.surrenderLootPanel.sync(this.currentLoserState.items);
	}

	private async resolveLocalChoice(localChoice: CombatChoice): Promise<void> {
		const otherState =
			this.localHumanRole === "attacker"
				? this.defenderState
				: this.attackerState;
		const otherArchetype =
			this.localHumanRole === "attacker"
				? this.defenderArchetype
				: this.attackerArchetype;

		const otherIsMonster =
			(this.localHumanRole !== "attacker" && this.isAttackerMonster) ||
			(this.localHumanRole === "attacker" && this.isDefenderMonster);

		const otherChoice = otherIsMonster
			? monsterCombatChoice(
					otherState.stats,
					this.localHumanRole === "defender" ? true : !this.isRangedInitiated,
				)
			: chooseCombatAction(otherState.hand, otherState.stats, otherArchetype, {
					currentHp: otherState.currentHp,
					opponentStats: localChoice.stats,
					canAttack:
						this.localHumanRole === "defender" ? true : !this.isRangedInitiated,
					againstMonster:
						this.localHumanRole === "attacker"
							? this.isAttackerMonster
							: this.isDefenderMonster,
					committed: this.localHumanRole === "defender",
					itemCount: otherState.items.filter((i) => i !== null).length,
				});

		const attackerChoice =
			this.localHumanRole === "attacker" ? localChoice : otherChoice;
		const defenderChoice =
			this.localHumanRole === "attacker" ? otherChoice : localChoice;

		await this.resolveRound(attackerChoice, defenderChoice);
	}

	private async resolveRound(
		attackerChoice: CombatChoice,
		defenderChoice: CombatChoice,
	): Promise<void> {
		if (this.roundInProgress) return;
		this.roundInProgress = true;

		if (attackerChoice.card) {
			const idx = this.attackerState.hand.findIndex(
				(c) => c.id === attackerChoice.card!.id,
			);
			if (idx !== -1) this.attackerState.hand.splice(idx, 1);
		}
		if (defenderChoice.card) {
			const idx = this.defenderState.hand.findIndex(
				(c) => c.id === defenderChoice.card!.id,
			);
			if (idx !== -1) this.defenderState.hand.splice(idx, 1);
		}

		const result = resolveCombatRound(attackerChoice, defenderChoice);

		// Both sides get locked in blind, showing them is simultaneous since nothing left to hide
		// and neither can change their mind
		if (this.attackerIndicator) {
			this.attackerIndicator.text = ACTION_LABELS[attackerChoice.action];
		}
		if (this.defenderIndicator) {
			this.defenderIndicator.text = ACTION_LABELS[defenderChoice.action];
		}
		await this.delay(REVEAL_PAUSE_MS);

		const applyAttackerDamage = () => {
			this.attackerState.currentHp -= result.a.damageTaken;
			this.attackerState.matchScore.damageDealt += result.b.damageTaken;
			this.syncHpDisplay();
		};
		const applyDefenderDamage = () => {
			this.defenderState.currentHp -= result.b.damageTaken;
			this.defenderState.matchScore.damageDealt += result.a.damageTaken;
			this.syncHpDisplay();
		};

		const bothAttacking =
			attackerChoice.action === "attack" && defenderChoice.action === "attack";

		if (bothAttacking) {
			// this is our sequential combat case, two real hits, coin flip decides who goes first
			const attackerFirst = Math.random() < 0.5;
			if (attackerFirst) {
				applyAttackerDamage();
				await this.delay(SEQUENTIAL_HIT_GAP_MS);
				applyDefenderDamage();
			} else {
				applyDefenderDamage();
				await this.delay(SEQUENTIAL_HIT_GAP_MS);
				applyAttackerDamage();
			}
		} else {
			// Everything else — Attack/Defend, Defend/Defend, any Run
			// combination — has at most one real hit (or none), so both
			// sides' outcomes apply together in a single beat.
			applyAttackerDamage();
			applyDefenderDamage();
		}

		await this.delay(POST_DAMAGE_PAUSE_MS);

		this.roundText.text = this.describeOutcome(
			attackerChoice,
			result.a,
			result.b,
		);

		const battleOver =
			this.attackerState.currentHp <= 0 ||
			this.defenderState.currentHp <= 0 ||
			attackerChoice.action === "surrender" ||
			defenderChoice.action === "surrender" ||
			result.a.escaped === true ||
			result.b.escaped === true ||
			this.currentRound >= this.maxRounds;

		if (battleOver) {
			void this.finishBattle(attackerChoice, defenderChoice);
			return;
		}

		await this.delay(BETWEEN_ROUNDS_MS);
		this.advanceToNextRound();
	}

	/**
	 * Resets round-local state and re-opens the same decision point for round N+1 —
	 * human gets the selector back, AI-vs-AI spectator mode re-runs auto-fight.
	 */
	private advanceToNextRound(): void {
		this.currentRound += 1;
		this.roundCounterText.text = `Round ${this.currentRound} / ${this.maxRounds}`;
		this.roundInProgress = false;

		if (this.localHumanRole === "none") {
			void this.runAutoFight();
			return;
		}

		this.selectorContainer.visible = true;
		this.selectorIndex = 0;
		this.selectorLabel.text =
			ACTION_LABELS[this.availableActions[this.selectorIndex]];
	}

	private describeOutcome(
		attackerChoice: CombatChoice,
		attackerOutcome: {
			damageTaken: number;
			nullified: boolean;
			escaped?: boolean;
			itemGiven?: boolean;
		},
		defenderOutcome: { damageTaken: number },
	): string {
		if (attackerChoice.action === "surrender")
			return `${this.attackerLabel} surrendered.`;
		if (attackerChoice.action === "run") {
			return attackerOutcome.escaped
				? `${this.attackerLabel} escaped!`
				: `Caught! ${this.attackerLabel} took ${attackerOutcome.damageTaken} damage.`;
		}
		return `${this.attackerLabel} dealt ${defenderOutcome.damageTaken} and took ${attackerOutcome.damageTaken}.`;
	}

	private async finishBattle(
		attackerChoice: CombatChoice,
		defenderChoice: CombatChoice,
	): Promise<void> {
		let attackerNeedsTeleport = false;
		let defenderNeedsTeleport = false;
		let attackerMonsterDied = false;
		let defenderMonsterDied = false;

		if (
			attackerChoice.action === "surrender" ||
			defenderChoice.action === "surrender"
		) {
			const surrenderer =
				attackerChoice.action === "surrender" ? "attacker" : "defender";
			const giverState =
				surrenderer === "attacker" ? this.attackerState : this.defenderState;
			const receiverState =
				surrenderer === "attacker" ? this.defenderState : this.attackerState;

			const receiverIsMonster =
				(surrenderer === "attacker" && this.isDefenderMonster) ||
				(surrenderer === "defender" && this.isAttackerMonster);

			const consequence = resolveSurrender(
				giverState.items.filter((i) => i !== null).length,
			);
			if (consequence.itemGiven && !receiverIsMonster) {
				await this.runSurrenderGiveSequence(
					giverState,
					receiverState,
					(surrenderer === "attacker" && this.localHumanRole === "attacker") ||
						(surrenderer === "defender" && this.localHumanRole === "defender"),
				);
			}

			if (surrenderer === "attacker") attackerNeedsTeleport = true;
			else defenderNeedsTeleport = true;
		} else {
			if (this.attackerState.currentHp <= 0) {
				if (this.isAttackerMonster) {
					attackerMonsterDied = true;
				} else {
					const defeatedByHunter = !this.isDefenderMonster;
					const consequence = resolveDefeat(
						this.attackerState.stats,
						defeatedByHunter,
					);
					this.attackerState.hpCeiling = consequence.hpCeiling;
					if (consequence.itemStolen && defeatedByHunter) {
						await this.runLootSequence(
							this.defenderState,
							this.attackerState,
							this.localHumanRole === "defender",
							true,
						);
					}
					attackerNeedsTeleport = true;
				}
			}

			if (this.defenderState.currentHp <= 0) {
				if (this.isDefenderMonster) {
					defenderMonsterDied = true;
				} else {
					const defeatedByHunter = !this.isAttackerMonster;
					const consequence = resolveDefeat(
						this.defenderState.stats,
						defeatedByHunter,
					);
					this.defenderState.hpCeiling = consequence.hpCeiling;
					if (consequence.itemStolen && defeatedByHunter) {
						await this.runLootSequence(
							this.attackerState,
							this.defenderState,
							this.localHumanRole === "attacker",
							true,
						);
					}
					defenderNeedsTeleport = true;
				}
			}
		}

		setTimeout(() => {
			this.game.overlays.hide();
			this.onComplete({
				attackerNeedsTeleport,
				defenderNeedsTeleport,
				attackerMonsterDied,
				defenderMonsterDied,
			});
		}, RESULT_LINGER_MS);
	}

	private layout(width: number, height: number): void {
		this.backdrop.clear();
		this.backdrop.rect(0, 0, width, height);
		this.backdrop.fill({ color: 0x000000, alpha: 1 });

		const s = computeUiScale(width, height);

		this.arena.scale.set(s);
		this.arena.x = width / 2;
		this.arena.y = height / 2 - uiPx(30, s);
		this.arena.rotation = 0;

		const panelW = uiPx(190, s);
		const panelH = uiPx(100, s);
		const margin = uiPx(16, s);

		this.attackerPanel.scale.set(s);
		this.defenderPanel.scale.set(s);
		this.attackerPanel.x = margin;
		this.attackerPanel.y = height - panelH - margin;
		this.defenderPanel.x = width - panelW - margin;
		this.defenderPanel.y = height - panelH - margin;

		this.localHand.resize(width, height, s, "center");
		this.localPlayZone.layout(width / 2, height / 2 - uiPx(30, s), s);

		this.winnerLootPanel.view.scale.set(s);
		this.loserLootPanel.view.scale.set(s);
		this.surrenderLootPanel.view.scale.set(s);
		this.lootConfirmPopup.scale.set(s);
	}
}
