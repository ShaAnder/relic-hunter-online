import { Container, Graphics, Text } from "pixi.js";
import { easeInOutCubic } from "@/math/easeInOutCubic";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import { Hand, SKIP_CARD_ID } from "@/ui/Hand";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import { computeUiScale, uiPx } from "@/math/uiScale";
import { computeFitScale } from "@/math/fitScale";
import { chooseCombatAction } from "@relic-hunter/shared";
import { CharacterSprite } from "@/entities/CharacterSprite";
import { toSpriteCharacterClass } from "@/types/characterSprite";
import type { IsoFacing, CharacterAnimation } from "@/types/characterSprite";
import { getIsoFacing, oppositeFacing } from "@/math/characterDirection";
import type {
	CardData,
	CardColor,
	CombatAction,
	CombatChoice,
	MercenaryState,
	AiArchetype,
} from "@relic-hunter/shared";
import { PlayZone } from "@/ui/PlayZone";
import { InventoryPanel } from "@/ui/InventoryPanel";
import {
	BattleController,
	type LootSequenceRequest,
} from "@/combat/BattleController";
import {
	decideLootChoice,
	decideSurrenderChoice,
	monsterCombatChoice,
} from "@relic-hunter/shared";
import { CombatActionMenu } from "../buttons/CombatActionMenu";

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
const POST_DAMAGE_PAUSE_MS = 600;
const BETWEEN_ROUNDS_MS = 800;

const LANDSCAPE_COLS = 15;
const LANDSCAPE_ROWS = 7;
const PORTRAIT_COLS = 7;
const PORTRAIT_ROWS = 15;
/** Whole-arena zoom (tiles + characters together) so characters read as more prominent without looking oversized relative to the grid. */
const ARENA_ZOOM = 1.25;
/** Character sprites specifically, on top of ARENA_ZOOM — requested as a modest 5-10% size-up, independent of the whole-arena scale. */
const ARENA_SPRITE_SIZE_UP = 1.075;
/** Design size the arena is authored at — fixed scale above this, only ever shrinks (never grows) if the real viewport is smaller. Not computeUiScale, which continuously scales down with any screen shrink — the arena is a game-world view, not UI chrome. */
const ARENA_DESIGN_W = 1000;
const ARENA_DESIGN_H = 600;
/** How long the run-up/run-back position tween takes, and how long walk plays alongside it. */
/** Matches walk's own duration (6 frames @ 4.5fps) so the position tween and the animation finish together — mismatched durations mean the token either "runs in place" after arriving early, or snaps to position while still mid-stride. */
const WALK_TWEEN_MS = 1333;
/** Halved from 500 to accommodate the slower walk above — otherwise the whole run-up/attack/run-back sequence grows even longer on top of an already-longer walk. */
const BEAT_PAUSE_MS = 250;
/** How many tiles short of the target's own tile a melee attacker stops. */
const MELEE_APPROACH_TILES = 1;

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

	/**
	 * Real, animatable tokens — a CharacterSprite for hunter
	 * combatants (feeding idle/walk/attack/defend/stunned), a plain
	 * placeholder circle for monsters, since no monster sprite sheets
	 * exist yet. Stored as fields (not local variables, which is what
	 * this replaced) specifically so resolveRound() can reference and
	 * animate them later.
	 */
	private attackerSprite?: CharacterSprite;
	private defenderSprite?: CharacterSprite;
	private attackerTokenView!: Container;
	private defenderTokenView!: Container;
	private attackerBaseFacing!: IsoFacing;
	private defenderBaseFacing!: IsoFacing;

	private attackerStatText!: Text;
	private defenderStatText!: Text;

	private combatActionMenu = new CombatActionMenu();

	private localHand!: Hand;
	private localPlayZone = new PlayZone();
	private pendingAction: CombatAction | null = null;

	/** Optional gate checked before an action commits — return false to block it. The gate owns showing feedback for a rejection; this class never knows why one was rejected. */
	private actionGate: ((action: CombatAction) => boolean) | null = null;
	/** Fires once, right after the overlay has actually built and laid out — the right moment for an external watcher to act on real button positions. */
	private readyCallback: (() => void) | null = null;

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

	/**
	 * Plays a named sequence of animations on a combatant's sprite,
	 * each one awaited to genuine completion before the next starts —
	 * not a fixed-duration guess. This is the one, general structure
	 * every multi-beat combat animation (attack's run→strike→run,
	 * future defend/stun sequences) should go through, rather than
	 * each getting its own bespoke, hand-timed logic. Safe to call
	 * with an undefined sprite (monster combatants, or a load that
	 * failed) — it's just a no-op in that case.
	 */
	private async playAnimationSequence(
		sprite: CharacterSprite | undefined,
		sequence: CharacterAnimation[],
		settleTo: CharacterAnimation = "idle",
	): Promise<void> {
		if (!sprite) return;
		for (const animation of sequence) {
			await sprite.playAsync(animation);
		}
		// idle (and other loops) never "complete" on their own — this is
		// a deliberate fire-and-forget settle, not another awaited beat.
		void sprite.play(settleTo);
	}

	/**
	 * One tile short of `to`, along the straight line from `from` —
	 * the arena only ever lays combatants out along a single row
	 * (landscape) or column (portrait), so this never needs real
	 * pathfinding, just linear interpolation.
	 */
	private computeApproachTile(
		from: { x: number; y: number },
		to: { x: number; y: number },
		tilesShortOf: number,
	): { x: number; y: number } {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const dist = Math.hypot(dx, dy);
		if (dist <= tilesShortOf) return { ...from };
		const t = (dist - tilesShortOf) / dist;
		return {
			x: Math.round(from.x + dx * t),
			y: Math.round(from.y + dy * t),
		};
	}

	/**
	 * Genuine positional movement, not in-place animation — tweens the
	 * token's actual screen position across the duration of the walk
	 * animation, then plays the given animation once arrived. Used for
	 * "run up to the enemy and strike" and, played with the from/to
	 * reversed, "run back to start."
	 */
	private async playMoveTo(
		token: Container,
		sprite: CharacterSprite | undefined,
		toGrid: { x: number; y: number },
		facing?: IsoFacing,
		durationMs: number = WALK_TWEEN_MS,
	): Promise<void> {
		if (sprite && facing) sprite.setDirection(facing);

		const toScreen = this.arenaGridToScreen(toGrid.x, toGrid.y);
		const fromX = token.x;
		const fromY = token.y;
		const toX = toScreen.x;
		const toY = toScreen.y; // matches the corrected initial placement (no floating offset)

		// Loop walk for the actual duration of travel, whatever that
		// turns out to be — a single playthrough freezing on its last
		// frame while the token keeps moving (if travel outlasts one
		// cycle, e.g. the longer escape-fade distance) is exactly the
		// bug this replaces. Explicitly stopped once travel completes,
		// not left to coincidentally finish at the same time.
		void sprite?.play("walk", { loop: true });

		const startTime = performance.now();
		await new Promise<void>((resolve) => {
			const step = () => {
				const t = Math.min(1, (performance.now() - startTime) / durationMs);
				token.x = fromX + (toX - fromX) * t;
				token.y = fromY + (toY - fromY) * t;
				if (t < 1) requestAnimationFrame(step);
				else resolve();
			};
			requestAnimationFrame(step);
		});
	}

	/**
	 * Full melee beat: run up (facing the target) to one tile short of
	 * it, idle a moment, strike in place, idle a moment, then run back
	 * home — facing flipped 180° for the return trip, since retreating
	 * is travel in the opposite direction from the approach. Facing
	 * flips back to the target once home, ready for the next round.
	 * This is the one, general structure — attacker and defender both
	 * go through it, just with their own tile/sprite/facing.
	 */
	private async playMeleeStrike(
		token: Container,
		sprite: CharacterSprite | undefined,
		homeTile: { x: number; y: number },
		targetTile: { x: number; y: number },
		facing: IsoFacing,
		applyDamage: () => void,
		onStrikeBegin?: () => void,
	): Promise<void> {
		const approachTile = this.computeApproachTile(
			homeTile,
			targetTile,
			MELEE_APPROACH_TILES,
		);
		await this.playMoveTo(token, sprite, approachTile, facing);
		void sprite?.play("idle");
		await this.delay(BEAT_PAUSE_MS);

		// Fires exactly as the strike begins, not before or after — the
		// synchronization point a defending opponent's own reaction
		// animation hangs off, so "defend" plays concurrently with the
		// strike rather than sequentially before/after it.
		onStrikeBegin?.();
		await this.playAnimationSequence(sprite, ["attack"]);
		applyDamage();

		void sprite?.play("idle");
		await this.delay(BEAT_PAUSE_MS);
		await this.playMoveTo(token, sprite, homeTile, oppositeFacing(facing));

		sprite?.setDirection(facing);
		void sprite?.play("idle");
	}

	/**
	 * Visual sequence for a Run action. Always starts the same way
	 * regardless of outcome — the runner plays walk in place, facing
	 * away from the opponent (the flee direction), as the "attempt".
	 * What happens next depends on whether the escape actually
	 * succeeded (already decided by the combat roll before any of
	 * this plays — the animation is revealing that outcome, not
	 * deciding it):
	 *  - Caught: the in-place walk stops, defend plays (stand-in for
	 *    stagger — no dedicated sprite yet), then the runner turns
	 *    back to face the opponent and settles to idle. No actual
	 *    movement happens at all in this branch.
	 *  - Escaped: the already-looping walk continues uninterrupted
	 *    into genuine travel, off the edge of the arena in the exact
	 *    direction the runner is already facing, fading out as it goes.
	 */
	private async playRunAwaySequence(
		runnerToken: Container,
		runnerSprite: CharacterSprite | undefined,
		runnerHomeTile: { x: number; y: number },
		runnerFacing: IsoFacing,
		chaserHomeTile: { x: number; y: number },
		escaped: boolean,
	): Promise<void> {
		// "Away" is the opposite of the runner's normal toward-opponent
		// facing. dx/dy is the same vector both the facing and the
		// actual travel direction derive from, so the two can never
		// diverge — a sprite facing one way while moving another was
		// never possible here to begin with; verified getIsoFacing and
		// gridToScreen share the same +x→se/-x→nw/+y→sw/-y→ne convention.
		const dx = runnerHomeTile.x - chaserHomeTile.x;
		const dy = runnerHomeTile.y - chaserHomeTile.y;
		const fleeFacing = oppositeFacing(runnerFacing);

		runnerSprite?.setDirection(fleeFacing);
		void runnerSprite?.play("walk", { loop: true });
		await this.delay(BEAT_PAUSE_MS);

		if (!escaped) {
			void runnerSprite?.play("defend");
			await this.delay(BEAT_PAUSE_MS);
			runnerSprite?.setDirection(runnerFacing);
			void runnerSprite?.play("idle");
			return;
		}

		const offArenaTile = {
			x: runnerHomeTile.x + dx * 2,
			y: runnerHomeTile.y + dy * 2,
		};
		const toScreen = this.arenaGridToScreen(offArenaTile.x, offArenaTile.y);
		const fromX = runnerToken.x;
		const fromY = runnerToken.y;
		const startTime = performance.now();
		const fadeDurationMs = WALK_TWEEN_MS * 1.5;
		await new Promise<void>((resolve) => {
			const step = () => {
				const t = Math.min(1, (performance.now() - startTime) / fadeDurationMs);
				const eased = easeInOutCubic(t);
				runnerToken.x = fromX + (toScreen.x - fromX) * eased;
				runnerToken.y = fromY + (toScreen.y - fromY) * eased;
				runnerToken.alpha = 1 - t;
				if (t < 1) requestAnimationFrame(step);
				else resolve();
			};
			requestAnimationFrame(step);
		});
		// Battle-over handling (loot, onComplete) happens right after
		// this returns — no need to reset alpha/position/facing since
		// the overlay is about to close.
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
		private pointerArrow = new Graphics(),
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
		this.combatActionMenu.onAction = (action) => this.confirmAction(action);
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
		this.readyCallback?.();
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
		this.attackerSprite?.update(deltaTime);
		this.defenderSprite?.update(deltaTime);
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
					this.game.session.rng,
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
					this.game.session.rng,
				);
		void this.resolveRound(attackerChoice, defenderChoice);
	}

	/**
	 * Discrete action buttons parented to the local player's character panel
	 * so they scale and move with it. Seed list ∩ role rules preserves
	 * tutorial locks (e.g. defend-only).
	 */
	private buildActionSelector(role: "attacker" | "defender"): void {
		const roleFiltered = this.allowedActionsFor(role);
		const seed = this.availableActions;
		this.availableActions = roleFiltered.filter((a) => seed.includes(a));

		this.combatActionMenu.setActions(this.availableActions);
		this.combatActionMenu.onAction = (action) => this.confirmAction(action);
		this.view.addChild(this.combatActionMenu.view);
		this.combatActionMenu.setVisible(true);

		this.pointerArrow.clear();
		this.view.addChild(this.pointerArrow);
	}

	/**
	 * Commits the chosen action: surrender resolves immediately, everything
	 * else opens hand selection for the allowed card colors.
	 */
	private confirmAction(action: CombatAction): void {
		if (this.actionGate && !this.actionGate(action)) {
			return;
		}

		this.combatActionMenu.setVisible(false);

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

	/** Optional gate checked before an action commits — return false to block it (and show whatever feedback the caller wants). Pass null to clear. */
	setActionGate(gate: ((action: CombatAction) => boolean) | null): void {
		this.actionGate = gate;
	}

	/** Fires once, right after the overlay has built and laid out. Pass null to clear. */
	setOnReady(callback: (() => void) | null): void {
		this.readyCallback = callback;
	}

	/** Screen position of a specific action button, or null if it isn't currently shown. */
	getActionButtonScreenPosition(
		action: CombatAction,
	): { x: number; y: number } | null {
		return this.combatActionMenu.getButtonScreenPosition(action);
	}

	/** Highlights one action button. Pass null to clear. */
	highlightAction(action: CombatAction | null): void {
		this.combatActionMenu.setHighlighted(action);
	}

	/** Dims every action button except one. Pass null to clear. */
	dimActionsExcept(action: CombatAction | null): void {
		this.combatActionMenu.setDimmedExcept(action);
	}

	/** Points an arrow at a specific action button. Pass null to clear. */
	showPointerAt(action: CombatAction | null): void {
		this.pointerArrow.clear();
		if (!action) return;

		const pos = this.combatActionMenu.getButtonScreenPosition(action);
		if (!pos) return;

		// Same gold triangle as MapScene's own ui pointer.
		const local = this.view.toLocal(pos);
		this.pointerArrow.poly([0, 0, 10, -16, -10, -16]);
		this.pointerArrow.fill(0xffd700);
		this.pointerArrow.x = local.x;
		this.pointerArrow.y = local.y - 28;
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
			this.buildActionSelector("attacker");
			this.view.addChild(this.localHand.view);
			this.localHand.syncFromHand(this.attackerState.hand);
		} else {
			this.buildAttackerIndicator();
			this.buildActionSelector("defender");
			this.view.addChild(this.localHand.view);
			this.localHand.syncFromHand(this.defenderState.hand);
		}

		this.roundText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 18, fontWeight: "bold" },
		});
		this.roundText.anchor.set(0.5);
		this.roundText.y = -150 / ARENA_ZOOM;
		this.roundText.scale.set(1 / ARENA_ZOOM);
		this.arena.addChild(this.roundText);

		this.roundCounterText = new Text({
			text: `Round ${this.currentRound} / ${this.maxRounds}`,
			style: { fill: 0xcccccc, fontSize: 14 },
		});
		this.roundCounterText.anchor.set(0.5);
		this.roundCounterText.y = -180 / ARENA_ZOOM;
		this.roundCounterText.scale.set(1 / ARENA_ZOOM);
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
		// Face each other based on actual arena positions — not a
		// hardcoded guess. attackerNear/tile assignment already varies
		// based on real map position (see attackerTile()/defenderTile()),
		// so a fixed facing was wrong as often as it was right.
		this.attackerBaseFacing = getIsoFacing(
			this.attackerTile(),
			this.defenderTile(),
		);
		this.defenderBaseFacing = getIsoFacing(
			this.defenderTile(),
			this.attackerTile(),
		);

		const attackerPos = this.arenaGridToScreen(
			this.attackerTile().x,
			this.attackerTile().y,
		);
		this.attackerTokenView = this.buildOneCombatantToken(
			this.isAttackerMonster,
			this.attackerColor,
			this.attackerState.characterClass,
			this.attackerBaseFacing,
			(sprite) => (this.attackerSprite = sprite),
		);
		this.attackerTokenView.x = attackerPos.x;
		this.attackerTokenView.y = attackerPos.y;
		this.arena.addChild(this.attackerTokenView);

		const defenderPos = this.arenaGridToScreen(
			this.defenderTile().x,
			this.defenderTile().y,
		);
		this.defenderTokenView = this.buildOneCombatantToken(
			this.isDefenderMonster,
			this.defenderColor,
			this.defenderState.characterClass,
			this.defenderBaseFacing,
			(sprite) => (this.defenderSprite = sprite),
		);
		this.defenderTokenView.x = defenderPos.x;
		this.defenderTokenView.y = defenderPos.y;
		this.arena.addChild(this.defenderTokenView);
	}

	/**
	 * A real CharacterSprite for hunter combatants (idle/walk/attack/
	 * defend/stunned all feed through it), or a plain placeholder
	 * circle for monsters — no monster sprite sheets exist yet, so
	 * this deliberately doesn't try to fake one.
	 */
	private buildOneCombatantToken(
		isMonster: boolean,
		color: number,
		characterClass: string,
		facing: IsoFacing,
		onSpriteReady: (sprite: CharacterSprite) => void,
	): Container {
		if (isMonster) {
			const token = new Graphics();
			token.circle(0, 0, 20);
			token.fill(color);
			return token;
		}

		const sprite = new CharacterSprite(
			toSpriteCharacterClass(characterClass),
			12, // confirmed correct for the arena's specific camera/tile setup
		);
		sprite.setExternalScale(sprite.getExternalScale() * ARENA_SPRITE_SIZE_UP);
		sprite.setDirection(facing);
		void sprite.init().then((ok) => {
			if (ok) onSpriteReady(sprite);
			// If loading fails, the view stays hidden (CharacterSprite's own
			// fallback) — resolveRound()'s animation calls below no-op safely
			// against an undefined attackerSprite/defenderSprite in that case.
		});
		return sprite.view;
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

	/**
	 * Intentionally a no-op — the "?"/action-name labels above each
	 * combatant's head were removed per explicit request. Kept as a
	 * method (not deleted outright) since it's called from onShow()
	 * and the space above their heads is planned for something else
	 * later.
	 */
	private buildAttackerIndicator(): void {}

	private buildDefenderIndicator(): void {}

	private onHandCardConfirmed(card: CardData): void {
		if (!this.pendingAction) return;
		const localState =
			this.localHumanRole === "attacker"
				? this.attackerState
				: this.defenderState;
		const chosenCard = card.id === SKIP_CARD_ID ? undefined : card;

		if (this.pendingAction === "attack" && chosenCard) {
			const v = chosenCard.value;

			if (
				chosenCard.color === "red" &&
				(typeof v === "number" || v === "A" || v === "C")
			) {
				localState.temporaryStatBonus.attack = v;
			} else {
				localState.temporaryStatBonus.attack = 0;
			}
		} else {
			localState.temporaryStatBonus.attack = 0;
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
			const index = decideLootChoice(
				loserState.items,
				targetItemId,
				this.game.session.rng,
			);
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
			const index = decideSurrenderChoice(
				giverState.items,
				targetItemId,
				this.game.session.rng,
			);
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
			: chooseCombatAction(
					otherState.hand,
					otherState.stats,
					otherArchetype,
					{
						currentHp: otherState.currentHp,
						opponentStats: localChoice.stats,
						canAttack:
							this.localHumanRole === "defender"
								? true
								: !this.isRangedInitiated,
						againstMonster:
							this.localHumanRole === "attacker"
								? this.isAttackerMonster
								: this.isDefenderMonster,
						committed: this.localHumanRole === "defender",
						itemCount: otherState.items.filter((i) => i !== null).length,
					},
					this.game.session.rng,
				);

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

		const resolution = BattleController.resolveRound(
			this.attackerState,
			this.defenderState,
			attackerChoice,
			defenderChoice,
			this.currentRound,
			this.maxRounds,
			this.game.session.rng,
		);
		const result = resolution.result;

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

		if (resolution.bothAttacking) {
			// this is our sequential combat case, two real hits, coin flip decides who goes first
			if (resolution.attackerFirst) {
				await this.playMeleeStrike(
					this.attackerTokenView,
					this.attackerSprite,
					this.attackerTile(),
					this.defenderTile(),
					this.attackerBaseFacing,
					applyAttackerDamage,
					() => void this.defenderSprite?.play("defend"),
				);
				await this.playMeleeStrike(
					this.defenderTokenView,
					this.defenderSprite,
					this.defenderTile(),
					this.attackerTile(),
					this.defenderBaseFacing,
					applyDefenderDamage,
					() => void this.attackerSprite?.play("defend"),
				);
			} else {
				await this.playMeleeStrike(
					this.defenderTokenView,
					this.defenderSprite,
					this.defenderTile(),
					this.attackerTile(),
					this.defenderBaseFacing,
					applyDefenderDamage,
					() => void this.attackerSprite?.play("defend"),
				);
				await this.playMeleeStrike(
					this.attackerTokenView,
					this.attackerSprite,
					this.attackerTile(),
					this.defenderTile(),
					this.attackerBaseFacing,
					applyAttackerDamage,
					() => void this.defenderSprite?.play("defend"),
				);
			}
		} else if (
			attackerChoice.action === "attack" &&
			defenderChoice.action === "defend"
		) {
			await this.playMeleeStrike(
				this.attackerTokenView,
				this.attackerSprite,
				this.attackerTile(),
				this.defenderTile(),
				this.attackerBaseFacing,
				() => {
					applyAttackerDamage();
					applyDefenderDamage();
				},
				() => void this.defenderSprite?.play("defend"),
			);
			// Defended successfully (0 damage taken) -> celebrate instead
			// of just settling back to idle.
			if (result.b.damageTaken === 0) {
				await this.defenderSprite?.playAsync("victory");
			}
			void this.defenderSprite?.play("idle");
		} else if (
			defenderChoice.action === "attack" &&
			attackerChoice.action === "defend"
		) {
			await this.playMeleeStrike(
				this.defenderTokenView,
				this.defenderSprite,
				this.defenderTile(),
				this.attackerTile(),
				this.defenderBaseFacing,
				() => {
					applyAttackerDamage();
					applyDefenderDamage();
				},
				() => void this.attackerSprite?.play("defend"),
			);
			if (result.a.damageTaken === 0) {
				await this.attackerSprite?.playAsync("victory");
			}
			void this.attackerSprite?.play("idle");
		} else if (attackerChoice.action === "run") {
			applyAttackerDamage();
			applyDefenderDamage();
			await this.playRunAwaySequence(
				this.attackerTokenView,
				this.attackerSprite,
				this.attackerTile(),
				this.attackerBaseFacing,
				this.defenderTile(),
				!!result.a.escaped,
			);
		} else if (defenderChoice.action === "run") {
			applyAttackerDamage();
			applyDefenderDamage();
			await this.playRunAwaySequence(
				this.defenderTokenView,
				this.defenderSprite,
				this.defenderTile(),
				this.defenderBaseFacing,
				this.attackerTile(),
				!!result.b.escaped,
			);
		} else {
			// Defend/Defend — no real hit, no positional movement.
			applyAttackerDamage();
			applyDefenderDamage();
		}

		await this.delay(POST_DAMAGE_PAUSE_MS);

		this.roundText.text = this.describeOutcome(
			attackerChoice,
			result.a,
			result.b,
		);

		if (resolution.battleOver) {
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

		this.combatActionMenu.setVisible(true);
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
		const decision = BattleController.resolveBattleEnd(
			this.attackerState,
			this.defenderState,
			attackerChoice,
			defenderChoice,
			this.isAttackerMonster,
			this.isDefenderMonster,
			this.localHumanRole,
		);

		for (const seq of decision.lootSequences) {
			await this.playLootSequence(seq);
		}

		setTimeout(() => {
			this.game.overlays.hide();
			this.onComplete({
				attackerNeedsTeleport: decision.attackerNeedsTeleport,
				defenderNeedsTeleport: decision.defenderNeedsTeleport,
				attackerMonsterDied: decision.attackerMonsterDied,
				defenderMonsterDied: decision.defenderMonsterDied,
			});
		}, RESULT_LINGER_MS);
	}

	/** Dispatches to whichever visual sequence the decision asked for — field names match each method's own parameters exactly, so there's nothing to remap here. */
	private async playLootSequence(seq: LootSequenceRequest): Promise<void> {
		if (seq.kind === "loot") {
			await this.runLootSequence(
				seq.winnerState,
				seq.loserState,
				seq.winnerIsLocal,
				seq.allowSkip,
			);
		} else {
			await this.runSurrenderGiveSequence(
				seq.giverState,
				seq.receiverState,
				seq.giverIsLocal,
			);
		}
	}

	private layout(width: number, height: number): void {
		this.backdrop.clear();
		this.backdrop.rect(0, 0, width, height);
		this.backdrop.fill({ color: 0x000000, alpha: 1 });

		const s = computeUiScale(width, height);
		const arenaScale = computeFitScale(
			width,
			height,
			ARENA_DESIGN_W,
			ARENA_DESIGN_H,
		);

		this.arena.scale.set(arenaScale * ARENA_ZOOM);
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

		if (this.localHumanRole !== "none") {
			const panel =
				this.localHumanRole === "attacker"
					? this.attackerPanel
					: this.defenderPanel;
			const panelW = uiPx(190, s);
			this.combatActionMenu.layoutAbovePanel(panel.x, panel.y, panelW, s);
		}
	}
}
