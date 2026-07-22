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
import { MoveController } from "@/systems/MoveController";
import { TurnManager } from "@/systems/TurnManager";
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

const MAX_GENERAL_SLOTS = 6;

/**
 * Tactical map scene: renders the isometric grid, hosts the mercenary,
 * and coordinates the AP turn system, move mode, cards, chests, and the
 * win condition.
 *
 * Button interaction is fully delegated to ButtonBar — MapScene receives
 * a ButtonAction string from handleClick and switches on intent. Pressing
 * Move opens Hand's card-selection mode rather than moving immediately;
 * the actual AP spend and aim mode only begin once a card is confirmed.
 * All turn arithmetic lives in TurnManager. This scene makes decisions and
 * wires systems together; it does none of the work itself.
 *
 * Map generation and chest contents are NOT decided here — LoadingScene
 * decides them (seed, chest plan) and stores them on GameSession before
 * this scene ever constructs, so the pre-match reveal and actual gameplay
 * always agree. A direct MapScene boot with nothing in session (dev/testing)
 * falls back to a fresh random seed and an empty chest plan.
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
	private placedChests: PlacedChest[] = [];
	// True during the Exit card's two-flight teleport sequence — blocks
	// End Turn / regenerate from interrupting mid-sequence, same role
	// mercenary.isAnimating plays for normal moves.
	private exitCardInProgress = false;
	private turnsTaken = 0;

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
		// animating, selecting a card, OR mid-Exit-card-sequence — the
		// player shouldn't be able to pan away during the linger between
		// the two flights, when isAnimating is briefly false again.
		if (
			this.moveController.active ||
			this.mercenary.isAnimating ||
			this.hand.isSelecting ||
			this.exitCardInProgress
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
	 * Toggle Move: cancel if currently aiming or selecting a card, otherwise
	 * open card selection. Guarded by turnManager.canMove up front — a
	 * greyed-out button can never open selection even if this somehow gets
	 * called directly, on top of ButtonBar's own disabled hitTest.
	 *
	 * The filter always excludes Attack, and additionally excludes Blue
	 * once a blue card has been played this turn. TurnManager.beginMovement
	 * already rejects a second blue at the data layer — greying it out here
	 * means the player never sees it as a live option in the first place.
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

	/**
	 * Commit a move path: advance position, deduct tiles, play animation,
	 * then check for a chest at the destination and whether this move just
	 * won the match. Resolves when the animation finishes.
	 */
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

	/**
	 * Place every chest from the session's chest plan onto distinct random
	 * walkable tiles, avoiding the exit tile and the player's spawn point.
	 * If the plan is missing (a direct MapScene boot with no LoadingScene
	 * run first) this simply places nothing — chests are optional, not a
	 * hard requirement for the scene to function.
	 */
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

	/**
	 * Open the chest at `coord` if one exists and isn't already opened.
	 * If the inventory's 6 general slots are already full, the chest stays
	 * closed and unopened — no forced drop, no swap prompt, per
	 * `11-item-inventory-win-design.md`. The player can return once they
	 * have room.
	 */
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

	/**
	 * Float a small icon + item name above the mercenary's head for a
	 * couple seconds. Placeholder shape until real item sprites exist —
	 * target items get a gold icon, everything else a plain white one.
	 */
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

	/**
	 * Standing on the Exit tile while holding the match's target item —
	 * arrived at via a normal move commit only. The Exit (E) card
	 * deliberately never reaches this check; see handleExitCard.
	 */
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

	/** Spend 2 AP on Attack and lock Move. Combat resolver deferred to Phase 2. */
	private handleAttack(): void {
		if (!this.turnManager.spendAttack()) return;
		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.showFeedback("⚔ Attack! (combat phase coming soon)");
	}

	/** Spend 1 AP on Rest and lock Move. Card draw deferred to Phase 1 card system. */
	private handleRest(): void {
		if (!this.turnManager.spendRest()) return;
		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.showFeedback("💤 Rested — card draw coming with the hand system");
	}

	/** Spend 1 AP on Disengage. Restricted move deferred to ZoC system. */
	private handleDisengage(): void {
		if (!this.turnManager.spendDisengage()) return;
		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.showFeedback("↩ Disengaged (ZoC escape coming soon)");
	}

	// ---------- End Turn ----------

	/**
	 * End the turn — shared by [E] key and the End Turn button.
	 * No-ops mid-animation so turn state can't desync from visuals.
	 *
	 * TEMP TESTING BEHAVIOUR: fully refills the hand back to the starter
	 * set every turn so the card flow can be exercised repeatedly without
	 * running out of cards. Replace with the real draw economy (draw 1/round,
	 * Rest draws up to 2, max hand 5) from `04-card-system-design.md`.
	 */
	private handleEndTurn(): void {
		if (this.mercenary.isAnimating || this.exitCardInProgress) return;
		this.moveController.exit();
		this.hand.exitSelectionMode();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.turnManager.endTurn();
		this.turnsTaken++;
	}

	// ---------- Input ----------

	/**
	 * [Esc] close local state first (aim/selection), then open Pause if
	 * nothing else was open — pressing it again while paused closes Pause.
	 * All other keys are ignored while paused. [E] end turn · [R] regenerate
	 * map · [←/→] move card caret · [Enter/Space] confirm highlighted card —
	 * the last two only act while Hand.isSelecting is true.
	 */
	private handleKeyDown = (event: KeyboardEvent): void => {
		if (this.game.overlays.isOpen) {
			if (event.key === "Escape") this.game.overlays.hide();
			return;
		}

		switch (event.key) {
			case "Escape":
				if (this.moveController.active || this.hand.isSelecting) {
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
			case "ArrowLeft":
				if (this.hand.isSelecting) this.hand.moveCaret(-1);
				break;
			case "ArrowRight":
				if (this.hand.isSelecting) this.hand.moveCaret(1);
				break;
			case "Enter":
			case " ":
				if (this.hand.isSelecting) this.hand.confirmHighlighted();
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
				if (this.moveController.active) this.moveController.tryCommit();
				break;
		}
	};

	/** Feed hovered tiles to the path preview while aiming. */
	/**
	 * Hand hover-reveal works regardless of aiming state — computed first,
	 * unconditionally. The existing move-preview logic still only runs
	 * while actively aiming, unchanged below it.
	 */
	private readonly HAND_HOVER_THRESHOLD_PX = 220;

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

	/**
	 * Show a temporary feedback message centered near the top of the screen.
	 * Auto-hides after ~2.5 seconds via the update loop timer.
	 */
	private showFeedback(message: string): void {
		this.feedbackText.text = message;
		this.feedbackText.visible = true;
		this.feedbackText.x =
			(this.game.app.screen.width - this.feedbackText.width) / 2;
		this.feedbackText.y = 60;
		this.feedbackTimer = 150;
	}

	/**
	 * Sync ButtonBar and stats overlay to current TurnManager state.
	 * Guarded against calls during construction — TurnManager fires
	 * onChanged from its own constructor, before buttonBar exists.
	 */
	private syncUI(): void {
		if (!this.buttonBar || !this.turnManager) return;
		this.buttonBar.sync(this.turnManager);
		this.hand.syncFromHand(this.mercState.hand);
		this.deckTracker.sync(this.turnManager);
		this.inventoryPanel.sync(this.mercState.items);
		// this.refreshStatsText();
	}

	// ---------- Cards ----------

	/**
	 * Apply the gameplay effect for a confirmed card. Hand has already
	 * shown the detail overlay and exited selection mode by the time this
	 * fires, but it no longer removes the card itself — Hand only renders
	 * whatever's in mercState.hand, it doesn't own the data. This method
	 * removes the card from the real hand first (making mercState.hand
	 * the immediate source of truth), then spends AP and enters aim mode.
	 * The visual hand catches up automatically the next time syncUI()
	 * runs, which beginMovement()'s onChanged() call triggers right below.
	 *
	 * Blue E is handled separately (handleExitCard) since it bypasses aim
	 * mode and normal pathing entirely — it's a teleport, not a move.
	 *
	 * Attack never reaches here — it's filtered out of Move-phase selection
	 * and still runs through the Action button (handleAttack).
	 */
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

	/**
	 * Resolve the Blue E (Exit) card as a two-flight sequence: fly to the
	 * exit tile first, linger there briefly, then fly to a random other
	 * tile. Per `11-item-inventory-win-design.md`, E never triggers the win
	 * condition regardless of whether the target item is carried — the win
	 * check lives specifically in onMoveCommitted, not here, and always
	 * will. This is purely a flavor/repositioning card.
	 *
	 * Guarded by exitCardInProgress so End Turn / regenerate can't fire
	 * mid-sequence — the same role mercenary.isAnimating plays elsewhere —
	 * and that flag also keeps the camera locked during the linger, when
	 * isAnimating briefly goes false between the two flights.
	 */
	/**
	 * Resolve the Blue E (Exit) card as a two-flight sequence: fly to the
	 * exit tile first, then check whether the target item is carried.
	 *
	 * If carrying the target: this wins the match immediately, skipping
	 * the linger and second flight entirely — reverses an earlier design
	 * decision (`11-item-inventory-win-design.md`'s original "E never
	 * triggers win") which this session's requirements explicitly
	 * override. If NOT carrying the target: linger briefly, then fly to a
	 * random other tile — a flavor/repositioning gamble, same as before.
	 */
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

	/**
	 * Fade out, fly there in a straight line, fade back in on arrival.
	 *
	 * The flight itself reuses Mercenary.moveAlongPath with a single
	 * waypoint — that produces a straight two-point polyline (current
	 * position → destination) using the same eased position interpolation
	 * as a normal move, with an explicit duration since a 1-tile "path"
	 * would otherwise animate far too fast for a cross-map flight.
	 *
	 * The sprite is set to alpha 0 for the flight's duration rather than
	 * `visible = false` — its position keeps updating throughout (that's
	 * what moveAlongPath is doing), so the camera's existing
	 * mercenary.isAnimating lock keeps tracking it the whole time even
	 * though nothing is drawn. It only "reappears" once alpha is restored
	 * on arrival. This is a placeholder for a real teleport VFX later —
	 * for now the fade is the whole effect.
	 */
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

	/**
	 * Rebuild the map with a fresh seed and reset turn state.
	 * No-ops mid-animation to avoid orphaning the moveAlongPath promise.
	 *
	 * Note: this generates a brand new seed/chest layout locally rather
	 * than going back through LoadingScene — [R] is a dev/testing shortcut,
	 * not part of the normal match flow, so it doesn't re-run the reveal.
	 */
	private regenerateMap(): void {
		if (this.mercenary.isAnimating || this.exitCardInProgress) return;

		this.moveController.exit();
		this.hand.exitSelectionMode();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();

		this.mapSeed = Math.floor(Math.random() * 1_000_000);
		this.grid = this.buildMap();
		this.mercState = this.spawnMercenary();

		this.mercenaryContainer.removeChildren();
		this.mercenary = new Mercenary(this.mercState.coord);
		this.mercenary.view.addChild(this.itemPopup);
		this.itemPopup.visible = false;
		this.mercenaryContainer.addChild(this.mercenary.view);

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
