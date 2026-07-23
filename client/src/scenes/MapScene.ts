import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Camera } from "@/core/cameras/Camera";
import {
	gridToScreen,
	screenToGrid,
	TILE_WIDTH,
	TILE_HEIGHT,
} from "@/math/isoGridMath";
import { Mercenary } from "@/entities/Mercenary";
import { Chest } from "@/entities/Chest";
import { ButtonBar } from "@/ui/buttons/ButtonBar";
import { DeckTracker } from "@/ui/DeckTracker";
import { InventoryPanel } from "@/ui/InventoryPanel";
import { PauseOverlay } from "@/ui/overlay/PauseOverlay";
import { BattleOverlay, type BattleResult } from "@/ui/overlay/BattleOverlay";
import { MoveController } from "@/systems/MoveController";
import { TurnManager } from "@/systems/TurnManager";
import {
	decideMovementTarget,
	decideEngagement,
	type ChestInfo,
} from "@relic-hunter/shared";
import {
	Grid,
	TileType,
	type GridCoord,
	type ItemData,
	type ChestPlan,
	type CardData,
	generateDungeon,
	findFirstWalkableTile,
	findExitTile,
	coordKey,
	createMercenary,
	spawnFromCharacter,
	buildSharedDeck,
	drawCardsInto,
	computeMovementRange,
	getPathTo,
	findNearestReachableTile,
	type MercenaryState,
} from "@relic-hunter/shared";
import { Hand } from "@/ui/Hand";
import { CharacterPanel } from "@/ui/CharacterPanel";
import { MAP_SIZE_DIMENSIONS } from "@/core/game/GameSession";
import { MatchResultScene } from "./MatchResultScene";
import { getActiveHunterWorldPos } from "@/core/cameras/TurnCamera";

/** A chest placed on the map, tying its visual entity to its plan and position. */
interface PlacedChest {
	coord: GridCoord;
	plan: ChestPlan;
	entity: Chest;
}

/** One enemy on the map — live state paired with its visual token. */
interface EnemyEntity {
	state: MercenaryState;
	mercenary: Mercenary;
}

const MAX_GENERAL_SLOTS = 6;

/**
 * Tactical map scene — grid, mercenary, AP turns, cards, chests, win condition.
 * Coordinates systems (TurnManager, MoveController, Hand, ButtonBar) rather
 * than doing the work itself. Map/chest content comes from GameSession
 * (set by LoadingScene), not decided here.
 * @author ShaAnder
 */
export class MapScene implements Scene {
	readonly view = new Container();

	// Board layers
	private grid: Grid;
	private boardContainer = new Container();
	private tilesContainer = new Container();
	private chestContainer = new Container();
	private mercenaryContainer = new Container();

	// Systems
	private camera: Camera;
	private turnManager: TurnManager;
	private moveController: MoveController;

	// Entities
	private mercState: MercenaryState;
	private mercenary: Mercenary;
	// Enemy list — 1 static entry for now, array from the start so targeting
	// (below) doesn't need a rewrite once real AI hunters/monsters exist.
	// See 09-enemy-ai-design-v3.md build order.
	private enemies: EnemyEntity[] = [];
	private placedChests: PlacedChest[] = [];
	// True during the Exit card's two-flight teleport sequence — blocks
	// End Turn / regenerate from interrupting mid-sequence, same role
	// mercenary.isAnimating plays for normal moves.
	private exitCardInProgress = false;
	private turnsTaken = 0;

	// Targeting mode — active while choosing which enemy to attack
	private targetingActive = false;
	private targetIndex = -1;
	private targetReticle = new Graphics();
	// Which enemy is mid-fight, so onBattleComplete knows who to update
	private activeCombatEnemyIndex: number | null = null;
	// Guards End Turn from re-firing while enemies are mid-move/mid-fight
	private processingEnemyTurns = false;

	// Character panel (top-right)
	private characterPanel: CharacterPanel;
	private deckTracker: DeckTracker;
	private inventoryPanel: InventoryPanel;

	// UI
	private buttonBar: ButtonBar;
	private statsText: Text;
	private feedbackText: Text;
	private feedbackTimer = 0;

	// Item pickup popup — floats above the mercenary's head, placeholder
	// icon until real item sprites exist
	private itemPopup = new Container();
	private itemPopupIcon = new Graphics();
	private itemPopupText: Text;
	private itemPopupTimer = 0;

	// Cards
	private hand: Hand;

	// Map config — dimensions and seed come from GameSession (set by
	// LoadingScene) rather than being hardcoded, so mission map size
	// selection actually does something.
	private readonly ROOM_DENSITY = 1 / 50;
	private mapWidth: number;
	private mapHeight: number;
	private roomCount: number;
	private mapSeed: number;

	/** How long the mercenary lingers, visible, at the exit tile before the second flight. */
	private readonly EXIT_CARD_LINGER_MS = 1000;
	/** Duration of each straight-line flight leg of the Exit card's teleport. */
	private readonly EXIT_FLIGHT_MS = 1500;

	private readonly TILE_COLORS: Record<TileType, number> = {
		[TileType.Floor]: 0x3a3a3a,
		[TileType.Wall]: 0x1a1a1a,
		[TileType.Exit]: 0xd4af37,
	};

	// Stats overlay timing
	private tileCount = 0;
	private lastGenerationMs = 0;
	private lastRenderMs = 0;
	private fpsAccumulator = 0;

	constructor(private game: Game) {
		// Dimensions + seed come from the mission/LoadingScene setup. Falls
		// back to sane defaults for direct MapScene boots during dev.
		const mapSize = this.game.session.missionParams?.mapSize ?? "M";
		const dims = MAP_SIZE_DIMENSIONS[mapSize];
		this.mapWidth = dims.width;
		this.mapHeight = dims.height;
		this.roomCount = Math.floor(
			this.mapWidth * this.mapHeight * this.ROOM_DENSITY,
		);
		this.mapSeed =
			this.game.session.mapSeed ?? Math.floor(Math.random() * 1_000_000);

		this.grid = this.buildMap();

		this.boardContainer.addChild(this.tilesContainer);
		this.boardContainer.addChild(this.chestContainer);
		this.boardContainer.addChild(this.mercenaryContainer);
		this.view.addChild(this.boardContainer);

		this.camera = new Camera(this.boardContainer, {
			initialZoom: 1.75,
			minZoom: 0.75,
			maxZoom: 3,
			panSpeed: 700,
		});

		this.mercState = this.spawnMercenary();
		this.mercenary = new Mercenary(this.mercState.coord);
		this.mercenaryContainer.addChild(this.mercenary.view);

		const enemyState = this.spawnEnemy();
		const enemyMercenary = new Mercenary(enemyState.coord, 0xe67e22);
		this.mercenaryContainer.addChild(enemyMercenary.view);
		this.enemies.push({ state: enemyState, mercenary: enemyMercenary });

		// Item popup rides along as a child of the mercenary's own view,
		// so it moves with the token automatically — no manual per-frame
		// position syncing needed.
		this.itemPopupText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 12, fontWeight: "bold" },
		});
		this.itemPopupText.anchor.set(0.5, 1);
		this.itemPopup.addChild(this.itemPopupIcon, this.itemPopupText);
		this.itemPopup.visible = false;
		this.mercenary.view.addChild(this.itemPopup);

		// Targeting reticle rides along on the player token, same as itemPopup
		this.targetReticle.visible = false;
		this.mercenary.view.addChild(this.targetReticle);

		this.spawnChests();

		this.characterPanel = new CharacterPanel();
		this.view.addChild(this.characterPanel.view);

		this.inventoryPanel = new InventoryPanel();
		this.view.addChild(this.inventoryPanel.view);

		this.deckTracker = new DeckTracker();
		this.view.addChild(this.deckTracker.view);

		// add hand
		this.hand = new Hand((card: CardData) => this.handleCardConfirmed(card));
		this.view.addChild(this.hand.view);

		// TurnManager fires syncUI on every state change. The shared deck
		// is lazily built here (??=) so a direct MapScene boot without
		// LoadingOverlay having run still works — and once built, the
		// SAME array reference is reused on every subsequent call, which
		// matters because TurnManager mutates it in place every draw.
		this.turnManager = new TurnManager(
			() => this.mercState,
			() => (this.game.session.sharedDeck ??= buildSharedDeck()),
			() => this.syncUI(),
		);
		// Top up to the full 5-card starting hand — the constructor above
		// already drew 1 via its own reset()→endTurn() cascade; this draws
		// the remaining 4 (drawCards is self-limiting on current hand size,
		// so this is safe regardless of how many were already drawn).
		this.turnManager.dealStartingHand();

		this.moveController = this.createMoveController();
		this.boardContainer.addChild(this.moveController.view);

		this.buttonBar = new ButtonBar();
		this.view.addChild(this.buttonBar.view);

		this.statsText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 14, fontFamily: "monospace" },
		});
		this.statsText.x = 12;
		this.statsText.y = 12;
		this.view.addChild(this.statsText);

		this.feedbackText = new Text({
			text: "",
			style: { fill: 0xffd700, fontSize: 16, fontWeight: "bold" },
		});
		this.feedbackText.visible = false;
		this.view.addChild(this.feedbackText);
	}

	/** Render the map, center the camera, and wire up input. */
	onEnter(): void {
		this.renderMap();
		this.centerCameraOnActiveHunter();
		this.camera.attach(this.game.app.canvas);
		this.buttonBar.resize(
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		this.hand.syncFromHand(this.mercState.hand);
		this.hand.resize(this.game.app.screen.width, this.game.app.screen.height);

		this.characterPanel.setCharacter(this.game.session.character);
		this.characterPanel.layout(this.game.app.screen.width);
		this.inventoryPanel.layout(this.game.app.screen.width);
		this.inventoryPanel.sync(this.mercState.items);
		this.deckTracker.layout(
			this.game.app.screen.width - 280,
			12 + 110 + 8 + 190 + 8,
		);

		this.syncUI();

		window.addEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.addEventListener("click", this.handleClick);
		this.game.app.canvas.addEventListener("mousemove", this.handleMouseMove);
	}

	/** Tear down visuals and input listeners. */
	onExit(): void {
		this.moveController.exit();
		this.buttonBar.closeMenu();
		this.boardContainer.removeChildren();
		this.camera.detach(this.game.app.canvas);
		window.removeEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.removeEventListener("click", this.handleClick);
		this.game.app.canvas.removeEventListener("mousemove", this.handleMouseMove);
	}

	/** Per-frame tick: camera, animation, camera follow, stats. */
	update(deltaTime: number): void {
		// Nothing in the scene should advance while paused — the overlay's
		// own update() still runs (via OverlayManager), this only freezes
		// MapScene's own logic so it resumes exactly where it left off.
		if (this.game.overlays.isOpen) return;

		this.camera.update(
			deltaTime,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		this.mercenary.update(deltaTime);
		this.hand.update(deltaTime);

		// Lock camera to the mercenary's VISUAL position while aiming,
		// animating, selecting a card, targeting, OR mid-Exit-card-sequence.
		if (
			this.moveController.active ||
			this.mercenary.isAnimating ||
			this.hand.isSelecting ||
			this.exitCardInProgress ||
			this.targetingActive
		) {
			this.camera.lockTo({
				x: this.mercenary.view.x,
				y: this.mercenary.view.y,
			});
		} else if (this.camera.isLocked) {
			this.camera.unlock();
		}

		if (this.feedbackTimer > 0) {
			this.feedbackTimer -= deltaTime;
			if (this.feedbackTimer <= 0) {
				this.feedbackText.visible = false;
			}
		}

		if (this.itemPopupTimer > 0) {
			this.itemPopupTimer -= deltaTime;
			if (this.itemPopupTimer <= 0) {
				this.itemPopup.visible = false;
			}
		}

		this.fpsAccumulator += deltaTime;
		if (this.fpsAccumulator >= 30) {
			this.fpsAccumulator = 0;
			// this.refreshStatsText();
		}
	}

	/** Reposition UI on window resize. */
	onResize(_width: number, height: number): void {
		this.buttonBar.resize(this.game.app.screen.width, height);
		this.hand.resize(this.game.app.screen.width, this.game.app.screen.height);
		this.characterPanel.layout(_width);
		this.inventoryPanel.layout(_width);
		this.deckTracker.layout(_width - 280, 12 + 110 + 8 + 190 + 8);
	}

	// ---------- Camera ----------

	private centerCameraOnActiveHunter(): void {
		const world = getActiveHunterWorldPos(this.game.session);
		this.camera.centerOn(
			world,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	// ---------- Move ----------

	/**
	 * Toggle Move: cancel if aiming/selecting, else open card selection.
	 * Filter excludes Attack and blue if already played this turn.
	 */
	private handleMovePressed(): void {
		if (this.moveController.active) {
			this.moveController.exit();
			this.buttonBar.setMoveActive(false);
			return;
		}

		if (this.hand.isSelecting) {
			this.hand.exitSelectionMode();
			this.buttonBar.setMoveActive(false);
			return;
		}

		if (!this.turnManager.canMove) return;

		const blueAlreadyUsed = this.turnManager.blueCardUsedThisTurn;
		this.hand.enterSelectionMode(
			(data) =>
				data.actionType !== "attack" &&
				!(data.color === "blue" && blueAlreadyUsed),
		);
		this.buttonBar.setMoveActive(true);
		this.buttonBar.closeMenu();
	}

	/** Commit a move: update position, deduct tiles, animate, check chest/win. */
	private async onMoveCommitted(
		target: GridCoord,
		path: GridCoord[],
	): Promise<void> {
		this.mercState.coord = target;
		this.turnManager.commitMove(path.length);
		this.buttonBar.setMoveActive(false);
		this.moveController.exit();

		await this.mercenary.moveAlongPath(path);

		this.tryOpenChestAt(target);
		this.checkWinCondition();

		this.syncUI();
	}

	// ---------- Chests & Items ----------

	/** Place chests from the session plan onto walkable tiles. No-ops if plan is missing. */
	private spawnChests(): void {
		this.chestContainer.removeChildren();
		this.placedChests = [];

		const sessionPlacements = this.game.session.chestPlacements;
		if (sessionPlacements && sessionPlacements.length > 0) {
			for (const record of sessionPlacements) {
				const entity = new Chest(record.coord);
				this.chestContainer.addChild(entity.view);
				this.placedChests.push({
					coord: record.coord,
					plan: record.plan,
					entity,
				});
			}
			return;
		}

		// Fallback — same random logic as before (dev / regen)
		const plan = this.game.session.chestPlan;
		if (!plan) return;

		const exitTile = findExitTile(this.grid);
		const used = new Set<string>();
		if (exitTile) used.add(coordKey(exitTile));
		used.add(coordKey(this.mercState.coord));

		for (const chestPlan of plan.chests) {
			const coord = this.pickUnusedWalkableTile(used);
			if (!coord) break;
			used.add(coordKey(coord));
			const entity = new Chest(coord);
			this.chestContainer.addChild(entity.view);
			this.placedChests.push({ coord, plan: chestPlan, entity });
		}
	}

	/** A random walkable tile not already in `used`. Null if none remain. */
	private pickUnusedWalkableTile(used: Set<string>): GridCoord | null {
		const candidates: GridCoord[] = [];
		for (let x = 0; x < this.grid.width; x++) {
			for (let y = 0; y < this.grid.height; y++) {
				const coord = { x, y };
				if (!this.grid.isWalkable(coord)) continue;
				if (used.has(coordKey(coord))) continue;
				candidates.push(coord);
			}
		}
		if (candidates.length === 0) return null;
		return candidates[Math.floor(Math.random() * candidates.length)];
	}

	/** Open the chest at coord if unopened. Stays closed if inventory (6 slots) is full. */
	private tryOpenChestAt(coord: GridCoord): void {
		const placed = this.placedChests.find(
			(c) => !c.entity.isOpen && c.coord.x === coord.x && c.coord.y === coord.y,
		);
		if (!placed) return;

		if (this.mercState.items.length >= MAX_GENERAL_SLOTS) {
			this.showFeedback("🎒 Inventory full — chest left unopened");
			return;
		}

		placed.entity.open();
		this.mercState.items.push(placed.plan.item);
		this.syncUI();

		if (placed.plan.isTarget) {
			this.showFeedback(
				`🎯 Found the target: ${placed.plan.item.name}! Head to the Exit.`,
			);
		} else {
			this.showFeedback(`📦 Found: ${placed.plan.item.name}`);
		}

		this.showItemPopup(placed.plan.item, placed.plan.isTarget);
	}

	/** Float an icon + item name above the mercenary's head briefly. */
	private showItemPopup(item: ItemData, isTarget: boolean): void {
		this.itemPopupIcon.clear();
		this.itemPopupIcon.circle(0, -46, 10);
		this.itemPopupIcon.fill(isTarget ? 0xffd700 : 0xffffff);
		this.itemPopupIcon.stroke({ width: 2, color: 0x000000, alpha: 0.6 });

		this.itemPopupText.text = item.name;
		this.itemPopupText.y = -58;

		this.itemPopup.visible = true;
		this.itemPopupTimer = 90; // ~1.5s at 60fps, matching feedbackTimer's frame-unit convention
	}

	// ---------- Enemy AI ----------

	/**
	 * Process every living enemy's turn, one at a time, after the player
	 * ends theirs. Each draws a card from the shared deck first — same
	 * mechanic as the player, and the reason every hunter drawing from one
	 * pool actually depletes it in a real match length instead of only the
	 * player ever touching it.
	 */
	private async processEnemyTurns(): Promise<void> {
		this.processingEnemyTurns = true;

		const sharedDeck = (this.game.session.sharedDeck ??= buildSharedDeck());

		for (const enemy of this.enemies) {
			if (enemy.state.currentHp <= 0) continue;
			drawCardsInto(enemy.state.hand, sharedDeck, 1);
			await this.processOneEnemyTurn(enemy);
		}

		this.processingEnemyTurns = false;
		this.syncUI();
	}

	/** Move toward the Balanced target, check for a chest, then decide whether to engage. */
	private async processOneEnemyTurn(enemy: EnemyEntity): Promise<void> {
		const chestInfos: ChestInfo[] = this.placedChests.map((c) => ({
			coord: c.coord,
			isOpen: c.entity.isOpen,
		}));

		const target = decideMovementTarget(
			enemy.state.coord,
			this.mercState.coord,
			this.isCarryingTarget(),
			chestInfos,
		);

		const range = computeMovementRange(
			this.grid,
			enemy.state.coord,
			enemy.state.stats.movement,
		);
		const reachable =
			findNearestReachableTile(range, target) ?? enemy.state.coord;
		const path = getPathTo(range, reachable) ?? [];

		if (path.length > 0) {
			enemy.state.coord = reachable;
			await enemy.mercenary.moveAlongPath(path);
		}

		this.tryEnemyOpenChest(enemy, enemy.state.coord);

		// Chebyshev adjacency, matching the player's own attack-range check
		// elsewhere — a pre-existing inconsistency with this grid's actual
		// cardinal-only movement (see EnemyAI.ts's Manhattan distance use),
		// not fixed here since it's a separate behavior change.
		const dx = Math.abs(enemy.state.coord.x - this.mercState.coord.x);
		const dy = Math.abs(enemy.state.coord.y - this.mercState.coord.y);
		if (Math.max(dx, dy) > 1) return;

		const shouldEngage = decideEngagement(
			enemy.state.stats,
			enemy.state.currentHp,
			this.mercState.stats,
			this.mercState.items.length,
		);
		if (shouldEngage) await this.aiInitiateCombat(enemy);
	}

	/** Chest pickup for an enemy — same rules as the player, no floating popup. */
	private tryEnemyOpenChest(enemy: EnemyEntity, coord: GridCoord): void {
		const placed = this.placedChests.find(
			(c) => !c.entity.isOpen && c.coord.x === coord.x && c.coord.y === coord.y,
		);
		if (!placed) return;
		if (enemy.state.items.length >= MAX_GENERAL_SLOTS) return;

		placed.entity.open();
		enemy.state.items.push(placed.plan.item);

		if (placed.plan.isTarget) {
			this.showFeedback("⚠️ An enemy hunter found the target item!");
		}
	}

	/**
	 * Opens the same BattleOverlay a player-initiated attack uses — the
	 * player still reacts interactively regardless of who started the
	 * fight. Returns a promise resolving once the fight ends, so
	 * processEnemyTurns correctly pauses on this enemy until the player
	 * actually resolves it before moving to the next one.
	 */
	private aiInitiateCombat(enemy: EnemyEntity): Promise<void> {
		return new Promise((resolve) => {
			const enemyIndex = this.enemies.indexOf(enemy);
			if (enemyIndex === -1) {
				resolve();
				return;
			}

			this.activeCombatEnemyIndex = enemyIndex;

			void this.game.overlays.show(
				new BattleOverlay(this.game, this.mercState, enemy.state, (result) => {
					this.onBattleComplete(result);
					resolve();
				}),
			);
		});
	}

	/** Win check: standing on Exit with target held, via normal move only. */
	private checkWinCondition(): void {
		const exitTile = findExitTile(this.grid);
		if (!exitTile) return;
		if (
			this.mercState.coord.x !== exitTile.x ||
			this.mercState.coord.y !== exitTile.y
		) {
			return;
		}

		if (!this.isCarryingTarget()) return;

		this.triggerWin();
	}

	/** Whether the mercenary currently holds this match's target item. */
	private isCarryingTarget(): boolean {
		const target = this.game.session.chestPlan?.targetItem;
		if (!target) return false;
		return this.mercState.items.some((item) => item.id === target.id);
	}

	/** Record the match result and transition to MatchResultScene. */
	private triggerWin(): void {
		this.game.session.matchResult = {
			won: true,
			turnsTaken: this.turnsTaken,
			itemsExtracted: this.mercState.items.length,
		};
		void this.game.sceneManager.changeScene(new MatchResultScene(this.game));
	}

	// ---------- Actions ----------

	/** Toggle targeting mode. Requires AP for Attack up front — no point entering otherwise. */
	private handleAttack(): void {
		if (this.targetingActive) {
			this.exitTargetingMode();
			return;
		}
		if (!this.turnManager.canAttack) {
			this.showFeedback("⚔ Not enough AP to attack");
			return;
		}
		if (this.livingEnemies().length === 0) {
			this.showFeedback("⚔ No enemies on the map");
			return;
		}

		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.enterTargetingMode();
	}

	/** All enemies still standing — the only valid targeting candidates. */
	private livingEnemies(): EnemyEntity[] {
		return this.enemies.filter((e) => e.state.currentHp > 0);
	}

	/** Show the reticle, sword cursor, default-select the nearest living enemy. */
	private enterTargetingMode(): void {
		const candidates = this.livingEnemies();
		if (candidates.length === 0) return;

		this.targetingActive = true;
		this.game.app.canvas.style.cursor = "crosshair"; // placeholder for a real sword cursor asset

		const nearestIndex = this.enemies.indexOf(
			candidates.reduce((closest, e) =>
				this.distanceToPlayer(e) < this.distanceToPlayer(closest) ? e : closest,
			),
		);
		this.setTarget(nearestIndex);
	}

	/** Hide the reticle, restore the cursor, drop the current selection. */
	private exitTargetingMode(): void {
		this.targetingActive = false;
		this.targetIndex = -1;
		this.targetReticle.visible = false;
		this.game.app.canvas.style.cursor = "default";
	}

	private distanceToPlayer(enemy: EnemyEntity): number {
		const dx = enemy.state.coord.x - this.mercState.coord.x;
		const dy = enemy.state.coord.y - this.mercState.coord.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	/** Point the reticle at a specific enemy index and redraw it. */
	private setTarget(index: number): void {
		this.targetIndex = index;
		this.targetReticle.visible = true;
		this.targetReticle.clear();
		this.targetReticle.poly([0, 0, 8, -12, -8, -12]);
		this.targetReticle.fill(0xffd700);
		this.targetReticle.y = -50;
	}

	/**
	 * Directional target cycling — picks the living enemy most aligned with
	 * the given direction (dot product) among those actually in front of
	 * the player that way, breaking ties toward the closer one. Logically
	 * sound but only genuinely testable once multiple enemies exist —
	 * with one enemy on the map, every direction just resolves to it or
	 * nothing.
	 */
	private cycleTarget(direction: "up" | "down" | "left" | "right"): void {
		if (!this.targetingActive) return;

		const vectors = {
			up: { dx: 0, dy: -1 },
			down: { dx: 0, dy: 1 },
			left: { dx: -1, dy: 0 },
			right: { dx: 1, dy: 0 },
		};
		const vec = vectors[direction];

		let bestIndex = -1;
		let bestScore = -Infinity;

		this.enemies.forEach((enemy, i) => {
			if (enemy.state.currentHp <= 0) return;
			const dx = enemy.state.coord.x - this.mercState.coord.x;
			const dy = enemy.state.coord.y - this.mercState.coord.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist === 0) return;

			const dot = (dx * vec.dx + dy * vec.dy) / dist;
			if (dot <= 0.3) return; // not meaningfully in that direction

			const score = dot - dist * 0.01;
			if (score > bestScore) {
				bestScore = score;
				bestIndex = i;
			}
		});

		if (bestIndex !== -1) this.setTarget(bestIndex);
	}

	/** Confirm the current target via keyboard (Enter/Space while targeting). */
	private confirmTarget(): void {
		if (this.targetIndex === -1) return;
		this.tryStartCombat(this.targetIndex);
	}

	/** Range-checks the target, spends AP, opens BattleOverlay if valid. */
	private tryStartCombat(enemyIndex: number): void {
		const enemy = this.enemies[enemyIndex];
		if (!enemy || enemy.state.currentHp <= 0) return;

		const dx = Math.abs(this.mercState.coord.x - enemy.state.coord.x);
		const dy = Math.abs(this.mercState.coord.y - enemy.state.coord.y);
		if (Math.max(dx, dy) > 1) {
			this.showFeedback("⚔ Target out of range");
			return;
		}
		if (!this.turnManager.spendAttack()) return;

		this.exitTargetingMode();
		this.activeCombatEnemyIndex = enemyIndex;

		void this.game.overlays.show(
			new BattleOverlay(this.game, this.mercState, enemy.state, (result) =>
				this.onBattleComplete(result),
			),
		);
	}

	/**
	 * Click-to-target: hit-tests the click against every living enemy
	 * token in board-local space. Only active while targeting; clicking
	 * anywhere that isn't an enemy cancels targeting instead.
	 */
	private handleTargetClick(screenX: number, screenY: number): boolean {
		if (!this.targetingActive) return false;

		const localX =
			(screenX - this.boardContainer.x) / this.boardContainer.scale.x;
		const localY =
			(screenY - this.boardContainer.y) / this.boardContainer.scale.y;

		const hitIndex = this.enemies.findIndex((e) => {
			if (e.state.currentHp <= 0) return false;
			const dx = e.mercenary.view.x - localX;
			const dy = e.mercenary.view.y - localY;
			return Math.sqrt(dx * dx + dy * dy) <= 20;
		});

		if (hitIndex !== -1) {
			this.tryStartCombat(hitIndex);
		} else {
			this.exitTargetingMode();
		}
		return true;
	}

	/** Enemy defeat/teleport are BattleOverlay's job via shared state; this handles the rest. */
	private onBattleComplete(result: BattleResult): void {
		const enemy =
			this.activeCombatEnemyIndex !== null
				? this.enemies[this.activeCombatEnemyIndex]
				: null;
		this.activeCombatEnemyIndex = null;

		if (result.enemyDefeated && enemy) {
			enemy.mercenary.view.visible = false;
			this.showFeedback("💀 Enemy defeated!");
		}

		if (result.playerNeedsTeleport) {
			const destination = this.randomWalkableTile(this.mercState.coord);
			if (destination) {
				this.mercState.coord = destination;
				const screenPos = gridToScreen(destination);
				this.mercenary.view.x = screenPos.x;
				this.mercenary.view.y = screenPos.y;
			}
		}

		this.syncUI();
	}

	/** Spend 1 AP on Rest, lock Move, draw up to 2 cards. */
	private handleRest(): void {
		if (!this.turnManager.spendRest()) return;
		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.showFeedback("💤 Rested — drew cards");
	}

	/** Spend 1 AP on Disengage. ZoC-restricted movement not yet implemented. */
	private handleDisengage(): void {
		if (!this.turnManager.spendDisengage()) return;
		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.showFeedback("↩ Disengaged (ZoC escape coming soon)");
	}

	// ---------- End Turn ----------

	/** End turn — shared by [E] key and End Turn button. No-ops mid-animation. */
	private handleEndTurn(): void {
		if (
			this.mercenary.isAnimating ||
			this.exitCardInProgress ||
			this.processingEnemyTurns
		) {
			return;
		}
		this.moveController.exit();
		this.hand.exitSelectionMode();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.turnManager.endTurn();
		this.turnsTaken++;
		void this.processEnemyTurns();
	}

	// ---------- Input ----------

	/** [Esc] cancel/pause toggle · [E] end turn · [R] regen · arrows+Enter for hand nav. */
	private handleKeyDown = (event: KeyboardEvent): void => {
		if (this.game.overlays.isOpen) {
			if (event.key === "Escape") this.game.overlays.hide();
			return;
		}

		switch (event.key) {
			case "Escape":
				if (this.targetingActive) {
					this.exitTargetingMode();
				} else if (this.moveController.active || this.hand.isSelecting) {
					this.moveController.exit();
					this.hand.exitSelectionMode();
					this.buttonBar.setMoveActive(false);
					this.buttonBar.closeMenu();
				} else {
					this.openPauseMenu();
				}
				break;
			case "e":
			case "E":
				this.handleEndTurn();
				break;
			case "r":
			case "R":
				this.regenerateMap();
				break;
			case "ArrowUp":
				if (this.targetingActive) this.cycleTarget("up");
				break;
			case "ArrowDown":
				if (this.targetingActive) this.cycleTarget("down");
				break;
			case "ArrowLeft":
				if (this.targetingActive) this.cycleTarget("left");
				else if (this.hand.isSelecting) this.hand.moveCaret(-1);
				break;
			case "ArrowRight":
				if (this.targetingActive) this.cycleTarget("right");
				else if (this.hand.isSelecting) this.hand.moveCaret(1);
				break;
			case "Enter":
			case " ":
				if (this.targetingActive) this.confirmTarget();
				else if (this.hand.isSelecting) this.hand.confirmHighlighted();
				break;
		}
	};

	/** Show the pause overlay. MapScene keeps existing untouched underneath — see OverlayManager. */
	private openPauseMenu(): void {
		void this.game.overlays.show(new PauseOverlay(this.game));
	}

	/** Delegate all click routing to ButtonBar, then switch on the returned action. */
	private handleClick = (event: MouseEvent): void => {
		if (this.game.overlays.isOpen) return;

		const { screenX, screenY } = this.getScreenPoint(event);
		const action = this.buttonBar.handleClick(screenX, screenY);

		switch (action) {
			case "move":
				this.handleMovePressed();
				break;
			case "attack":
				this.handleAttack();
				break;
			case "rest":
				this.handleRest();
				break;
			case "disengage":
				this.handleDisengage();
				break;
			case "endTurn":
				this.handleEndTurn();
				break;
			case null:
				if (this.handleTargetClick(screenX, screenY)) break;
				if (this.moveController.active) this.moveController.tryCommit();
				break;
		}
	};

	/** Hover threshold for revealing the hand — checked unconditionally, not just while aiming. */
	private readonly HAND_HOVER_THRESHOLD_PX = 220;

	/** Feed hovered tiles to the path preview while aiming; hand-reveal check always runs. */
	private handleMouseMove = (event: MouseEvent): void => {
		if (this.game.overlays.isOpen) return;

		const { screenX, screenY } = this.getScreenPoint(event);

		this.hand.setHovered(
			screenY > this.game.app.screen.height - this.HAND_HOVER_THRESHOLD_PX,
		);

		if (!this.moveController.active) return;
		this.moveController.onHover(this.screenPointToGrid(screenX, screenY));
	};

	// ---------- UI ----------

	/** Show a temporary top-of-screen message, auto-hides after ~2.5s. */
	private showFeedback(message: string): void {
		this.feedbackText.text = message;
		this.feedbackText.visible = true;
		this.feedbackText.x =
			(this.game.app.screen.width - this.feedbackText.width) / 2;
		this.feedbackText.y = 60;
		this.feedbackTimer = 150;
	}

	/** Sync all UI to TurnManager state. Guarded — fires before buttonBar exists during construction. */
	private syncUI(): void {
		if (!this.buttonBar || !this.turnManager) return;
		this.buttonBar.sync(this.turnManager);
		this.hand.syncFromHand(this.mercState.hand);
		this.deckTracker.sync(this.turnManager);
		this.inventoryPanel.sync(this.mercState.items);
		// this.refreshStatsText();
	}

	// ---------- Cards ----------

	/** Removes card from real hand, spends AP. Blue E routes to handleExitCard; Attack doesn't reach here. */
	private handleCardConfirmed(card: CardData): void {
		// Remove the played card from the real hand (source of truth) —
		// this no-ops harmlessly for the synthetic "No Card" skip option,
		// which is never actually part of mercState.hand to begin with.
		const handIndex = this.mercState.hand.findIndex((c) => c.id === card.id);
		if (handIndex !== -1) this.mercState.hand.splice(handIndex, 1);

		if (card.color === "blue" && card.value === "E") {
			this.handleExitCard();
			return;
		}

		const cardType = card.id === "__skip__" ? "none" : card.color;
		const numericValue = typeof card.value === "number" ? card.value : 0;

		if (!this.turnManager.beginMovement(cardType, numericValue)) {
			return;
		}

		this.moveController.requestEnter();
		this.buttonBar.setMoveActive(this.moveController.active);

		if (card.actionType === "defense") {
			this.showFeedback(
				`🛡️ Defense ${card.value} active this turn (effect coming soon)`,
			);
		} else if (card.actionType === "stun") {
			this.showFeedback("🪤 Trap card selected — placement coming soon");
		}
	}

	/** Exit card: fly to exit, win immediately if carrying target, else linger + random flight. */
	private async handleExitCard(): Promise<void> {
		if (!this.turnManager.beginMovement("blue", 0)) return;

		this.exitCardInProgress = true;

		const exitTile = findExitTile(this.grid);
		if (exitTile) {
			this.showFeedback("🌀 Exit card played — heading to the exit...");
			await this.flyMercenaryTo(exitTile);

			if (this.isCarryingTarget()) {
				this.exitCardInProgress = false;
				this.triggerWin();
				return;
			}
		}

		await this.delay(this.EXIT_CARD_LINGER_MS);

		const destination = this.randomWalkableTile(this.mercState.coord);
		if (destination) {
			await this.flyMercenaryTo(destination);
		}

		this.showFeedback("🌀 Teleported randomly");
		this.exitCardInProgress = false;
	}

	/** Fade out, fly in a straight line, fade in on arrival. Alpha 0 while moving, not visible=false, so the camera still tracks it. */
	private async flyMercenaryTo(coord: GridCoord): Promise<void> {
		this.mercenary.view.alpha = 0;
		this.mercState.coord = coord;
		await this.mercenary.moveAlongPath([coord], this.EXIT_FLIGHT_MS);
		this.mercenary.view.alpha = 1;
	}

	/** Promise-based delay — used for the Exit card's linger between flights. */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/** Pick a random walkable (Floor) tile on the grid, excluding one coord. */
	private randomWalkableTile(exclude: GridCoord): GridCoord | null {
		const candidates: GridCoord[] = [];

		for (let x = 0; x < this.grid.width; x++) {
			for (let y = 0; y < this.grid.height; y++) {
				const tile = this.grid.getTile({ x, y });
				if (!tile || tile.type !== TileType.Floor) continue;
				if (tile.coord.x === exclude.x && tile.coord.y === exclude.y) continue;
				candidates.push(tile.coord);
			}
		}

		if (candidates.length === 0) return null;
		return candidates[Math.floor(Math.random() * candidates.length)];
	}

	// ---------- Helpers ----------

	/** Single construction point for MoveController wiring. */
	private createMoveController(): MoveController {
		return new MoveController({
			grid: this.grid,
			camera: this.camera,
			mercenary: this.mercenary,
			getMercenaryCoord: () => this.mercState.coord,
			getMovementRemaining: () => this.turnManager.movementRemaining,
			onMoveCommitted: (target: GridCoord, path: GridCoord[]) =>
				this.onMoveCommitted(target, path),
		});
	}

	/** [R] dev shortcut: fresh seed/map/chests locally, no LoadingScene round-trip. */
	private regenerateMap(): void {
		if (this.mercenary.isAnimating || this.exitCardInProgress) return;

		this.moveController.exit();
		this.hand.exitSelectionMode();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.exitTargetingMode();

		this.mapSeed = Math.floor(Math.random() * 1_000_000);
		this.grid = this.buildMap();
		this.mercState = this.spawnMercenary();

		this.mercenaryContainer.removeChildren();
		this.mercenary = new Mercenary(this.mercState.coord);
		this.mercenary.view.addChild(this.itemPopup);
		this.itemPopup.visible = false;
		this.targetReticle.visible = false;
		this.mercenary.view.addChild(this.targetReticle);
		this.mercenaryContainer.addChild(this.mercenary.view);

		this.enemies = [];
		const enemyState = this.spawnEnemy();
		const enemyMercenary = new Mercenary(enemyState.coord, 0xe67e22);
		this.mercenaryContainer.addChild(enemyMercenary.view);
		this.enemies.push({ state: enemyState, mercenary: enemyMercenary });

		this.game.session.chestPlan = null;
		this.game.session.chestPlacements = null;
		this.game.session.playerSpawn = null;
		this.spawnChests();

		this.hand.syncFromHand(this.mercState.hand);
		this.turnManager.reset();
		this.turnManager.dealStartingHand();
		this.turnsTaken = 0;

		this.boardContainer.removeChild(this.moveController.view);
		this.moveController = this.createMoveController();
		this.boardContainer.addChild(this.moveController.view);

		this.renderMap();
		this.centerCameraOnMap();
		this.syncUI();
	}

	/** Convert a mouse event to canvas-local screen coordinates. */
	private getScreenPoint(event: MouseEvent) {
		const rect = this.game.app.canvas.getBoundingClientRect();
		return {
			screenX: event.clientX - rect.left,
			screenY: event.clientY - rect.top,
		};
	}

	/** Convert canvas-local screen coordinates to a grid tile. */
	private screenPointToGrid(screenX: number, screenY: number): GridCoord {
		const localX =
			(screenX - this.boardContainer.x) / this.boardContainer.scale.x;
		const localY =
			(screenY - this.boardContainer.y) / this.boardContainer.scale.y;
		return screenToGrid(localX, localY);
	}

	/** Generate the map grid, timing it for the stats overlay. */
	private buildMap(): Grid {
		const start = performance.now();
		const grid = generateDungeon(this.mapWidth, this.mapHeight, {
			seed: this.mapSeed,
			roomCount: this.roomCount,
		});
		this.lastGenerationMs = performance.now() - start;
		return grid;
	}

	/** Place the player mercenary on the first walkable tile. */
	private spawnMercenary(): MercenaryState {
		const spawnCoord = this.game.session.playerSpawn ??
			findFirstWalkableTile(this.grid) ?? { x: 0, y: 0 };

		const character = this.game.session.character;
		if (character) {
			return spawnFromCharacter(character, spawnCoord);
		}

		return createMercenary("player", spawnCoord, {
			movement: 4,
			attack: 3,
			defense: 2,
			maxHp: 20,
			ap: 3,
		});
	}

	/** Static non-AI enemy near player spawn, for testing combat. See `09-enemy-ai-design-v3.md`. */
	private spawnEnemy(): MercenaryState {
		const playerSpawn = this.mercState.coord;
		const candidate = { x: playerSpawn.x + 3, y: playerSpawn.y };
		const spawnCoord = this.grid.isWalkable(candidate)
			? candidate
			: (findFirstWalkableTile(this.grid) ?? { x: 0, y: 0 });

		return createMercenary("enemy_static_1", spawnCoord, {
			movement: 3,
			attack: 3,
			defense: 2,
			maxHp: 15,
			ap: 3,
		});
	}

	/** Draw every tile diamond, timing the build for the stats overlay. */
	private renderMap(): void {
		const start = performance.now();
		this.tilesContainer.removeChildren();

		let count = 0;
		for (let x = 0; x < this.grid.width; x++) {
			for (let y = 0; y < this.grid.height; y++) {
				const tile = this.grid.getTile({ x, y });
				if (!tile) continue;
				count++;
				const screenPos = gridToScreen(tile.coord);
				const diamond = this.drawTileDiamond(this.TILE_COLORS[tile.type]);
				diamond.x = screenPos.x;
				diamond.y = screenPos.y;
				this.tilesContainer.addChild(diamond);
			}
		}

		this.tileCount = count;
		this.lastRenderMs = performance.now() - start;
	}

	/** Build one iso diamond tile graphic in the given color. */
	private drawTileDiamond(color: number): Graphics {
		const g = new Graphics();
		g.poly([
			0,
			-TILE_HEIGHT / 2,
			TILE_WIDTH / 2,
			0,
			0,
			TILE_HEIGHT / 2,
			-TILE_WIDTH / 2,
			0,
		]);
		g.fill(color);
		g.stroke({ width: 1, color: 0x000000, alpha: 0.3 });
		return g;
	}

	/** Snap the camera to the centre of the map. */
	private centerCameraOnMap(): void {
		const bounds = this.boardContainer.getLocalBounds();
		this.camera.centerOn(
			{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	// /** Rebuild the debug/stats overlay text. */
	// private refreshStatsText(): void {
	// 	const tm = this.turnManager;
	// 	this.statsText.text = [
	// 		`Map: ${this.mapWidth}x${this.mapHeight} Rooms: ${this.roomCount} Seed: ${this.mapSeed}`,
	// 		`Tiles: ${this.tileCount} Gen: ${this.lastGenerationMs.toFixed(1)}ms Build: ${this.lastRenderMs.toFixed(1)}ms`,
	// 		`FPS: ${Math.round(this.game.app.ticker.FPS)}`,
	// 		`AP: ${tm.apRemaining}/${tm.baseAP}  |  Moves: ${tm.movePressesUsed}/2  |  Locked: ${tm.moveLocked ? "YES" : "no"}`,
	// 		`Attacked: ${tm.hasAttackedThisTurn ? "YES" : "no"}  |  Rested: ${tm.hasRestedThisTurn ? "YES" : "no"}  |  Pool: ${tm.movementRemaining}`,
	// 		`Turns: ${this.turnsTaken}  |  Items: ${this.mercState.items.length}/${MAX_GENERAL_SLOTS}`,
	// 		`[Esc] cancel  ·  [E] end turn  ·  [R] regenerate`,
	// 	].join("\n");
	// }
}
