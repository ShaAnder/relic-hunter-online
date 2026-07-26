import { Container, Graphics, Text } from "pixi.js";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import { Hand, SKIP_CARD_ID } from "@/ui/Hand";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
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
const ARENA_COLS = 15;
const ARENA_ROWS = 7;
const MID_ROW = Math.floor(ARENA_ROWS / 2);

// Attacker always renders lower on screen, defender always upper — trivial
// by design, no branching. Whoever attacked gets this tile, full stop.
const ATTACKER_TILE = { x: ARENA_COLS - 2, y: MID_ROW };
const DEFENDER_TILE = { x: 1, y: MID_ROW };

/** Which role (if any) the person looking at this screen is controlling. "none" = spectator, both sides auto-decide. */
export type LocalHumanRole = "attacker" | "defender" | "none";

export interface BattleResult {
	attackerNeedsTeleport: boolean;
	defenderNeedsTeleport: boolean;
}

/**
 * Iso arena combat overlay, layered on MapScene via OverlayManager.
 * Attacker/defender are roles, not fixed identities — the caller supplies
 * each role's actual state, color, label, and archetype directly rather
 * than this class inferring "is this human." That's deliberate: once
 * live multiplayer exists, both roles could be real distinct players, and
 * a single "the player" assumption baked in here wouldn't generalize.
 * @param game - active Game instance
 * @param attackerState - live state of whoever initiated this fight
 * @param defenderState - live state of whoever's being fought
 * @param onComplete - fired once the round resolves and the overlay hides
 * @param attackerColor - display color for the attacker's token/panel
 * @param attackerLabel - display name for the attacker
 * @param defenderColor - display color for the defender's token/panel
 * @param defenderLabel - display name for the defender
 * @param attackerArchetype - biases the attacker's auto-decided actions, if not the local human
 * @param defenderArchetype - biases the defender's auto-decided actions, if not the local human
 * @param localHumanRole - which role (if any) is interactively controlled this session
 * @param mirrored - flips the arena left/right so the attacker's real map-relative side is preserved
 * @author ShaAnder
 */
export class BattleOverlay implements Overlay {
	readonly view = new Container();

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

	// Action selector — cycles through ACTIONS, confirms on center-label click
	private selectorContainer = new Container();
	private selectorIndex = 0;
	private selectorLabel!: Text;

	// Real Hand component — same fan/caret/selection logic as the overworld,
	// synced from whichever role the local human actually controls.
	private localHand!: Hand;
	private pendingAction: CombatAction | null = null;

	private resolved = false;

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
		private mirrored: boolean = false,
	) {
		this.localHand = new Hand(this.game.app.stage, (card) =>
			this.onHandCardConfirmed(card),
		);
	}

	onShow(): void {
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onHide(): void {
		this.localHand.exitSelectionMode();
	}

	update(deltaTime: number): void {
		this.localHand.update(deltaTime);
	}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	private mirrorPos(pos: { x: number; y: number }): { x: number; y: number } {
		return this.mirrored ? { x: -pos.x, y: pos.y } : pos;
	}

	private async runAutoFight(): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, 700));

		const attackerChoice = chooseCombatAction(
			this.attackerState.hand,
			this.attackerState.stats,
			this.attackerArchetype,
		);
		const defenderChoice = chooseCombatAction(
			this.defenderState.hand,
			this.defenderState.stats,
			this.defenderArchetype,
		);

		void this.resolveRound(attackerChoice, defenderChoice);
	}

	// ---------- UI construction ----------

	private buildUI(): void {
		this.backdrop.eventMode = "static";
		this.view.addChild(this.backdrop);
		this.view.addChild(this.arena);

		this.buildArenaGrid();
		this.buildCombatantTokens();
		this.buildCornerPanels();

		if (this.localHumanRole === "none") {
			this.buildAttackerIndicator();
			this.buildDefenderIndicator();
		} else if (this.localHumanRole === "attacker") {
			this.buildDefenderIndicator();
			this.buildActionSelector(ATTACKER_TILE);
			this.view.addChild(this.localHand.view);
			this.localHand.syncFromHand(this.attackerState.hand);
		} else {
			this.buildAttackerIndicator();
			this.buildActionSelector(DEFENDER_TILE);
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

		this.syncHpDisplay();

		if (this.localHumanRole === "none") {
			void this.runAutoFight();
		}
	}

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

	/** Tokens colored per the caller-supplied identity — no inference, just rendered as given. */
	private buildCombatantTokens(): void {
		const attackerPos = this.mirrorPos(
			this.arenaGridToScreen(ATTACKER_TILE.x, ATTACKER_TILE.y),
		);
		const attackerToken = new Graphics();
		attackerToken.circle(0, 0, 20);
		attackerToken.fill(this.attackerColor);
		attackerToken.x = attackerPos.x;
		attackerToken.y = attackerPos.y - 14;
		this.arena.addChild(attackerToken);

		const defenderPos = this.mirrorPos(
			this.arenaGridToScreen(DEFENDER_TILE.x, DEFENDER_TILE.y),
		);
		const defenderToken = new Graphics();
		defenderToken.circle(0, 0, 20);
		defenderToken.fill(this.defenderColor);
		defenderToken.x = defenderPos.x;
		defenderToken.y = defenderPos.y - 14;
		this.arena.addChild(defenderToken);
	}

	/** Corner panels — attacker left, defender right, always (not mirrored, this is UI chrome not battlefield). */
	private buildCornerPanels(): void {
		this.buildOnePanel(
			this.attackerPanel,
			this.attackerHpBar,
			this.attackerLabel,
			this.attackerState,
			this.attackerColor,
			true,
		);
		this.buildOnePanel(
			this.defenderPanel,
			this.defenderHpBar,
			this.defenderLabel,
			this.defenderState,
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
		state: MercenaryState,
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

	/** "?" placeholder above the attacker until their choice is revealed at resolution. */
	private buildAttackerIndicator(): void {
		const pos = this.mirrorPos(
			this.arenaGridToScreen(ATTACKER_TILE.x, ATTACKER_TILE.y),
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

	/** "?" placeholder above the defender until their choice is revealed at resolution. */
	private buildDefenderIndicator(): void {
		const pos = this.mirrorPos(
			this.arenaGridToScreen(DEFENDER_TILE.x, DEFENDER_TILE.y),
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

	/** "< Action >" cycling selector above whichever role the local human controls. */
	private buildActionSelector(tile: { x: number; y: number }): void {
		const pos = this.mirrorPos(this.arenaGridToScreen(tile.x, tile.y));
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

	/**
	 * Fires when the local human confirms a card — same callback shape
	 * MapScene uses for its own hand. Resolves whichever action is
	 * currently pending; "No Card" (Hand's built-in skip option) resolves
	 * with no card, same as choosing not to play one.
	 */
	private onHandCardConfirmed(card: CardData): void {
		if (!this.pendingAction) return;
		const localStats =
			this.localHumanRole === "attacker"
				? this.attackerState.stats
				: this.defenderState.stats;
		const chosenCard = card.id === SKIP_CARD_ID ? undefined : card;
		void this.resolveLocalChoice({
			action: this.pendingAction,
			stats: localStats,
			card: chosenCard,
		});
		this.pendingAction = null;
	}

	/** The local human made their choice — auto-decide the other role, then resolve both. */
	private async resolveLocalChoice(localChoice: CombatChoice): Promise<void> {
		const otherState =
			this.localHumanRole === "attacker"
				? this.defenderState
				: this.attackerState;
		const otherArchetype =
			this.localHumanRole === "attacker"
				? this.defenderArchetype
				: this.attackerArchetype;

		const otherChoice = chooseCombatAction(
			otherState.hand,
			otherState.stats,
			otherArchetype,
		);

		const attackerChoice =
			this.localHumanRole === "attacker" ? localChoice : otherChoice;
		const defenderChoice =
			this.localHumanRole === "attacker" ? otherChoice : localChoice;

		await this.resolveRound(attackerChoice, defenderChoice);
	}

	// ---------- Resolution ----------

	private async resolveRound(
		attackerChoice: CombatChoice,
		defenderChoice: CombatChoice,
	): Promise<void> {
		if (this.resolved) return;
		this.resolved = true;

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

		if (this.attackerIndicator) {
			this.attackerIndicator.text = ACTION_LABELS[attackerChoice.action];
		}
		if (this.defenderIndicator) {
			this.defenderIndicator.text = ACTION_LABELS[defenderChoice.action];
		}

		this.attackerState.currentHp -= result.a.damageTaken;
		this.defenderState.currentHp -= result.b.damageTaken;
		this.syncHpDisplay();

		this.roundText.text = this.describeOutcome(
			attackerChoice,
			result.a,
			result.b,
		);

		this.finishBattle(attackerChoice);
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

	/** Apply round consequences to shared state, then report what MapScene needs to do. */
	private finishBattle(attackerChoice: CombatChoice): void {
		let attackerNeedsTeleport = false;
		let defenderNeedsTeleport = false;

		if (attackerChoice.action === "surrender") {
			const consequence = resolveSurrender(this.attackerState.items.length);
			if (consequence.itemGiven) {
				const given = this.attackerState.items.shift();
				if (given) this.defenderState.items.push(given);
			}
			attackerNeedsTeleport = true;
		} else {
			if (this.attackerState.currentHp <= 0) {
				const consequence = resolveDefeat(this.attackerState.stats, true);
				this.attackerState.currentHp = consequence.hpCeiling;
				this.attackerState.hpCeiling = consequence.hpCeiling;
				if (consequence.itemStolen && this.attackerState.items.length > 0) {
					const stolen = this.attackerState.items.shift();
					if (stolen) this.defenderState.items.push(stolen);
				}
				attackerNeedsTeleport = true;
			}

			if (this.defenderState.currentHp <= 0) {
				const consequence = resolveDefeat(this.defenderState.stats, true);
				this.defenderState.currentHp = consequence.hpCeiling;
				this.defenderState.hpCeiling = consequence.hpCeiling;
				if (consequence.itemStolen && this.defenderState.items.length > 0) {
					const stolen = this.defenderState.items.shift();
					if (stolen) this.attackerState.items.push(stolen);
				}
				defenderNeedsTeleport = true;
			}
		}

		setTimeout(() => {
			this.game.overlays.hide();
			this.onComplete({ attackerNeedsTeleport, defenderNeedsTeleport });
		}, RESULT_LINGER_MS);
	}

	// ---------- Layout ----------

	private layout(width: number, height: number): void {
		this.backdrop.clear();
		this.backdrop.rect(0, 0, width, height);
		this.backdrop.fill({ color: 0x000000, alpha: 1 });

		this.arena.x = width / 2;
		this.arena.y = height / 2 - 30;

		this.attackerPanel.x = 24;
		this.attackerPanel.y = height - 124;

		this.defenderPanel.x = width - 214;
		this.defenderPanel.y = height - 124;

		this.localHand.resize(width, height);
	}
}
