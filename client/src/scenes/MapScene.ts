import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "../core/Scene";
import type { Game } from "../core/Game";
import { Camera } from "../core/Camera";
import {
	gridToScreen,
	screenToGrid,
	TILE_WIDTH,
	TILE_HEIGHT,
} from "../math/isoGridMath";
import { Mercenary } from "../entities/Mercenary";
import { ButtonBar } from "../ui/ButtonBar";
import { MoveController } from "../systems/MoveController";
import { TurnManager } from "../systems/TurnManager";
import {
	Grid,
	TileType,
	type GridCoord,
	generateDungeon,
	findFirstWalkableTile,
	createMercenary,
	type MercenaryState,
} from "@relic-hunter/shared";
import { Hand } from "../ui/Hand";
import { CardData } from "../entities/Card";

/**
 * Tactical map scene: renders the isometric grid, hosts the mercenary,
 * and coordinates the AP turn system, move mode, and camera.
 *
 * Button interaction is fully delegated to ButtonBar — MapScene receives
 * a ButtonAction string from handleClick and switches on intent. All turn
 * arithmetic lives in TurnManager. This scene makes decisions and wires
 * systems together; it does none of the work itself.
 */
export class MapScene implements Scene {
	readonly view = new Container();

	// Board layers
	private grid: Grid;
	private boardContainer = new Container();
	private tilesContainer = new Container();
	private mercenaryContainer = new Container();

	// Systems
	private camera: Camera;
	private turnManager: TurnManager;
	private moveController: MoveController;

	// Entities
	private mercState: MercenaryState;
	private mercenary: Mercenary;

	// UI
	private buttonBar: ButtonBar;
	private statsText: Text;
	private feedbackText: Text;
	private feedbackTimer = 0;

	// Cards
	private hand: Hand;

	// Map config
	private readonly MAP_WIDTH = 50;
	private readonly MAP_HEIGHT = 50;
	private readonly ROOM_DENSITY = 1 / 50;
	private readonly ROOM_COUNT = Math.floor(
		this.MAP_WIDTH * this.MAP_HEIGHT * this.ROOM_DENSITY,
	);
	private mapSeed = 42;

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
		this.grid = this.buildMap();

		// Board layer order: tiles → move overlay → mercenary
		this.boardContainer.addChild(this.tilesContainer);
		this.boardContainer.addChild(this.mercenaryContainer);
		this.view.addChild(this.boardContainer);

		this.camera = new Camera(this.boardContainer, {
			initialZoom: 1.75,
			minZoom: 0.75,
			maxZoom: 3,
			panSpeed: 700,
		});

		// Spawn player mercenary
		this.mercState = this.spawnMercenary();
		this.mercenary = new Mercenary(this.mercState.coord);
		this.mercenaryContainer.addChild(this.mercenary.view);

		// add hand
		this.hand = new Hand((card: CardData) => this.handleCardPlayed(card));
		this.view.addChild(this.hand.view);

		// TurnManager fires syncUI on every state change
		this.turnManager = new TurnManager(
			() => this.mercState,
			() => this.syncUI(),
		);

		this.moveController = this.createMoveController();
		this.boardContainer.addChild(this.moveController.view);

		// Sidebar button bar
		this.buttonBar = new ButtonBar();
		this.view.addChild(this.buttonBar.view);

		// Stats overlay
		this.statsText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 14, fontFamily: "monospace" },
		});
		this.statsText.x = 12;
		this.statsText.y = 12;
		this.view.addChild(this.statsText);

		// Action feedback line — hidden until showFeedback() is called
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
		this.centerCameraOnMap();
		this.camera.attach(this.game.app.canvas);
		this.buttonBar.resize(
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		this.hand.initStarterHand();
		this.hand.resize(this.game.app.screen.width, this.game.app.screen.height);

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
		this.camera.update(
			deltaTime,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		this.mercenary.update(deltaTime);

		// Lock camera to the mercenary's VISUAL position while aiming or animating
		if (this.moveController.active || this.mercenary.isAnimating) {
			this.camera.lockTo({
				x: this.mercenary.view.x,
				y: this.mercenary.view.y,
			});
		} else if (this.camera.isLocked) {
			this.camera.unlock();
		}

		// Fade out action feedback after its timer expires
		if (this.feedbackTimer > 0) {
			this.feedbackTimer -= deltaTime;
			if (this.feedbackTimer <= 0) {
				this.feedbackText.visible = false;
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
	}

	// ---------- Move ----------

	/**
	 * Begin a Move action and enter aim mode.
	 * Phase 1 stub — card selection replaces hardcoded values once hand exists.
	 */
	private handleMovePressed(): void {
		if (this.moveController.active) {
			this.moveController.exit();
			this.buttonBar.setMoveActive(false);
			return;
		}

		// TODO Phase 1 card system: open card selection overlay, pass chosen type + value
		const cardType = "none";
		const cardValue = 0;
		if (!this.turnManager.beginMovement(cardType, cardValue)) return;

		this.moveController.enter();
		this.buttonBar.setMoveActive(this.moveController.active);
		this.buttonBar.closeMenu();
	}

	/**
	 * Commit a move path: advance position, deduct tiles, play animation.
	 * Resolves when the animation finishes.
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
		this.syncUI();
	}

	// ---------- Actions ----------

	/** Spend 2 AP on Attack and lock Move. Combat resolver deferred to Phase 2. */
	private handleAttack(): void {
		if (!this.turnManager.spendAttack()) return;
		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.showFeedback("⚔ Attack! (combat phase coming soon)");
		// TODO Phase 2: open combat resolver
	}

	/** Spend 1 AP on Rest and lock Move. Card draw deferred to Phase 1 card system. */
	private handleRest(): void {
		if (!this.turnManager.spendRest()) return;
		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.showFeedback("💤 Rested — card draw coming with the hand system");
		// TODO Phase 1 card system: draw up to 2 cards
	}

	/** Spend 1 AP on Disengage. Restricted move deferred to ZoC system. */
	private handleDisengage(): void {
		if (!this.turnManager.spendDisengage()) return;
		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.showFeedback("↩ Disengaged (ZoC escape coming soon)");
		// TODO ZoC system: trigger restricted 1–2 tile disengage move
	}

	// ---------- End Turn ----------

	/**
	 * End the turn — shared by [E] key, End Turn button, and Pass button.
	 * No-ops mid-animation so turn state can't desync from visuals.
	 */
	private handleEndTurn(): void {
		if (this.mercenary.isAnimating) return;
		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.turnManager.endTurn();
	}

	// ---------- Input ----------

	/** [Esc] cancel aim · [E] end turn · [R] regenerate map. */
	private handleKeyDown = (event: KeyboardEvent): void => {
		switch (event.key) {
			case "Escape":
				this.moveController.exit();
				this.buttonBar.setMoveActive(false);
				this.buttonBar.closeMenu();
				break;
			case "e":
			case "E":
				this.handleEndTurn();
				break;
			case "r":
			case "R":
				this.regenerateMap();
				break;
		}
	};

	/** Delegate all click routing to ButtonBar, then switch on the returned action. */
	private handleClick = (event: MouseEvent): void => {
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
				// No button hit — board click while aiming = commit move
				if (this.moveController.active) this.moveController.tryCommit();
				break;
		}
	};

	/** Feed hovered tiles to the path preview while aiming. */
	private handleMouseMove = (event: MouseEvent): void => {
		if (!this.moveController.active) return;
		const { screenX, screenY } = this.getScreenPoint(event);
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
		this.feedbackTimer = 150; // ~2.5s at 60fps frame units
	}

	/**
	 * Sync ButtonBar and stats overlay to current TurnManager state.
	 * Guarded against calls during construction — TurnManager fires
	 * onChanged from its own constructor, before buttonBar exists.
	 */
	private syncUI(): void {
		if (!this.buttonBar || !this.turnManager) return;
		this.buttonBar.sync(this.turnManager);
		// this.refreshStatsText();
	}

	// ---------- Cards ----------
	private handleCardPlayed(card: CardData): void {
		if (this.mercenary.isAnimating) return;

		switch (card.actionType) {
			case "move":
				// Blue card — start movement with bonus
				if (this.turnManager.beginMovement(card.color, card.value)) {
					this.moveController.enter();
					this.buttonBar.setMoveActive(this.moveController.active);
				}
				break;

			case "attack":
				this.handleAttack(); // reuse existing handler
				break;

			case "defense":
				this.showFeedback("🛡️ Defense +" + card.value + " (coming soon)");
				// TODO: implement defense buff
				break;

			case "stun":
				this.showFeedback("🌟 Stun! (coming soon)");
				// TODO: stun enemy
				break;
		}
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
			onMoveCommitted: (target, path) => this.onMoveCommitted(target, path),
		});
	}

	/**
	 * Rebuild the map with a fresh seed and reset turn state.
	 * No-ops mid-animation to avoid orphaning the moveAlongPath promise.
	 */
	private regenerateMap(): void {
		if (this.mercenary.isAnimating) return;

		this.moveController.exit();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();

		this.mapSeed = Math.floor(Math.random() * 1_000_000);
		this.grid = this.buildMap();
		this.mercState = this.spawnMercenary();

		this.mercenaryContainer.removeChildren();
		this.mercenary = new Mercenary(this.mercState.coord);
		this.mercenaryContainer.addChild(this.mercenary.view);

		this.hand.initStarterHand();
		this.turnManager.reset();

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
		const grid = generateDungeon(this.MAP_WIDTH, this.MAP_HEIGHT, {
			seed: this.mapSeed,
			roomCount: this.ROOM_COUNT,
		});
		this.lastGenerationMs = performance.now() - start;
		return grid;
	}

	/** Place the player mercenary on the first walkable tile. */
	private spawnMercenary(): MercenaryState {
		const spawnCoord = findFirstWalkableTile(this.grid) ?? { x: 0, y: 0 };
		return createMercenary("player", spawnCoord, {
			speed: 4,
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
	// 		`Map: ${this.MAP_WIDTH}x${this.MAP_HEIGHT} Rooms: ${this.ROOM_COUNT} Seed: ${this.mapSeed}`,
	// 		`Tiles: ${this.tileCount} Gen: ${this.lastGenerationMs.toFixed(1)}ms Build: ${this.lastRenderMs.toFixed(1)}ms`,
	// 		`FPS: ${Math.round(this.game.app.ticker.FPS)}`,
	// 		`AP: ${tm.apRemaining}/${tm.baseAP}  |  Moves: ${tm.movePressesUsed}/2  |  Locked: ${tm.moveLocked ? "YES" : "no"}`,
	// 		`Attacked: ${tm.hasAttackedThisTurn ? "YES" : "no"}  |  Rested: ${tm.hasRestedThisTurn ? "YES" : "no"}  |  Pool: ${tm.movementRemaining}`,
	// 		`[Esc] cancel  ·  [E] end turn  ·  [R] regenerate`,
	// 	].join("\n");
	// }
}
