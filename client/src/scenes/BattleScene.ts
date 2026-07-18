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
import { MoveButton } from "../ui/MoveButton";
import { MoveController } from "../systems/MoveController";
import {
	Grid,
	TileType,
	type GridCoord,
	generateDungeon,
	findFirstWalkableTile,
	createMercenary,
	type MercenaryState,
} from "@relic-hunter/shared";

/**
 * Tactical battle scene: renders the map grid, hosts the mercenary,
 * and coordinates move mode, the camera, and the minimal turn system.
 *
 * The turn system is a single flag for now (one Move per turn, [E] ends
 * the turn) and grows into a real TurnManager once dice and cards land.
 * Camera lock/follow is driven from update() so it can track the
 * mercenary's visual position through the whole move animation.
 */
export class BattleScene implements Scene {
	readonly view = new Container();

	// Board layers
	private grid: Grid;
	private boardContainer = new Container();
	private tilesContainer = new Container();
	private mercenaryContainer = new Container();

	// Systems + UI
	private camera: Camera;
	private statsText: Text;
	private moveButton: MoveButton;
	private moveController: MoveController;

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

	// Player state
	private mercState: MercenaryState;
	private mercenary: Mercenary;
	private movementRemaining = 0;

	// Minimal turn system — one Move per turn, reset by endTurn()
	private hasMovedThisTurn = false;

	// Stats overlay
	private tileCount = 0;
	private lastGenerationMs = 0;
	private lastRenderMs = 0;
	private fpsRefreshAccumulator = 0;

	constructor(private game: Game) {
		this.grid = this.buildMap();

		// Board layer order: tiles under mercenary
		this.boardContainer.addChild(this.tilesContainer);
		this.boardContainer.addChild(this.mercenaryContainer);
		this.view.addChild(this.boardContainer);

		this.camera = new Camera(this.boardContainer, {
			initialZoom: 1.75,
			minZoom: 0.75,
			maxZoom: 3,
			panSpeed: 700,
		});

		// Spawn the player mercenary
		this.mercState = this.spawnMercenary();
		this.movementRemaining = this.mercState.stats.speed;
		this.mercenary = new Mercenary(this.mercState.coord);
		this.mercenaryContainer.addChild(this.mercenary.view);

		// MoveController owns range + path preview rendering
		this.moveController = this.createMoveController();
		this.boardContainer.addChild(this.moveController.view);

		// Stats overlay
		this.statsText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 14, fontFamily: "monospace" },
		});
		this.statsText.x = 12;
		this.statsText.y = 12;
		this.view.addChild(this.statsText);

		// Move button
		this.moveButton = new MoveButton();
		this.view.addChild(this.moveButton.view);
		this.positionMoveButton();
	}

	/** Render the map, center the camera, and wire up input. */
	onEnter(): void {
		this.renderMap();
		this.centerCameraOnMap();
		this.camera.attach(this.game.app.canvas);

		window.addEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.addEventListener("click", this.handleClick);
		this.game.app.canvas.addEventListener("mousemove", this.handleMouseMove);
	}

	/** Tear down visuals and input listeners. */
	onExit(): void {
		this.moveController.exit();
		this.boardContainer.removeChildren();
		this.camera.detach(this.game.app.canvas);
		window.removeEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.removeEventListener("click", this.handleClick);
		this.game.app.canvas.removeEventListener("mousemove", this.handleMouseMove);
	}

	/** Per-frame tick: camera, mercenary animation, follow logic, stats. */
	update(deltaTime: number): void {
		this.camera.update(
			deltaTime,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		this.mercenary.update(deltaTime);

		// Camera lock + follow: while aiming or animating, track the
		// mercenary's VISUAL position — the logical coord jumps to the
		// destination instantly on commit, the token doesn't.
		if (this.moveController.active || this.mercenary.isAnimating) {
			this.camera.lockTo({
				x: this.mercenary.view.x,
				y: this.mercenary.view.y,
			});
		} else if (this.camera.isLocked) {
			this.camera.unlock();
		}

		this.fpsRefreshAccumulator += deltaTime;
		if (this.fpsRefreshAccumulator >= 30) {
			this.fpsRefreshAccumulator = 0;
			this.refreshStatsText();
		}
	}

	/** Keep UI anchored on window resize. */
	onResize(_width: number, height: number): void {
		this.moveButton.view.x = 20;
		this.moveButton.view.y = height - 60;
	}

	// ---------- Move mode integration ----------

	/**
	 * Apply a committed move: update logical state, spend the turn's Move,
	 * and play the path animation. Resolves when the animation finishes.
	 */
	private async onMoveCommitted(
		target: GridCoord,
		path: GridCoord[],
	): Promise<void> {
		this.mercState.coord = target;

		// Movement is one committed action — leftover budget isn't
		// spendable this turn, so zero it rather than decrement
		this.movementRemaining = 0;

		// Spend the turn's single Move
		this.hasMovedThisTurn = true;
		this.moveButton.setActive(false);
		this.moveButton.setEnabled(false);

		// exit() unlocks the camera, but update() re-locks next frame
		// because isAnimating is true — the camera stays on the hunter
		this.moveController.exit();

		await this.mercenary.moveAlongPath(path);
		this.refreshStatsText();
	}

	/**
	 * Reset the Move allowance and movement budget.
	 * No-ops mid-animation so turn state can't desync from the visuals.
	 */
	private endTurn(): void {
		if (this.mercenary.isAnimating) return;

		this.hasMovedThisTurn = false;
		this.movementRemaining = this.mercState.stats.speed;
		this.moveController.exit();
		this.moveButton.setEnabled(true);
		this.moveButton.setActive(false);
		this.refreshStatsText();
	}

	// ---------- Input ----------

	/** [Esc] cancel aim · [E] end turn · [R] regenerate map. */
	private handleKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			this.moveController.exit();
			this.moveButton.setActive(false);
			return;
		}

		if (event.key === "e" || event.key === "E") {
			this.endTurn();
			return;
		}

		if (event.key === "r" || event.key === "R") {
			this.regenerateMap();
		}
	};

	/** Route clicks to the Move button or, in move mode, to a commit. */
	private handleClick = (event: MouseEvent): void => {
		const { screenX, screenY } = this.getScreenPoint(event);

		// Move button toggle (hitTest returns false while disabled)
		if (this.moveButton.hitTest(screenX, screenY)) {
			if (this.moveController.active) {
				this.moveController.exit();
				this.moveButton.setActive(false);
			} else {
				this.moveController.enter();
				// enter() can refuse — only light the button if it engaged
				this.moveButton.setActive(this.moveController.active);
			}
			return;
		}

		if (this.moveController.active) {
			this.moveController.tryCommit();
		}
	};

	/** Feed hovered tiles to the path preview while aiming. */
	private handleMouseMove = (event: MouseEvent): void => {
		if (!this.moveController.active) return;

		const { screenX, screenY } = this.getScreenPoint(event);
		const hovered = this.screenPointToGrid(screenX, screenY);
		this.moveController.onHover(hovered);
	};

	// ---------- Helpers ----------

	/**
	 * Single construction point for MoveController wiring — constructor
	 * and [R] regen both use this so the config can't drift.
	 */
	private createMoveController(): MoveController {
		return new MoveController({
			grid: this.grid,
			camera: this.camera,
			mercenary: this.mercenary,
			getMercenaryCoord: () => this.mercState.coord,
			getMovementRemaining: () => this.movementRemaining,
			getCanMove: () => !this.hasMovedThisTurn,
			onMoveCommitted: (target, path) => this.onMoveCommitted(target, path),
		});
	}

	/**
	 * Rebuild the map with a fresh seed and reset turn state.
	 * No-ops mid-animation — discarding the mercenary mid-move would
	 * leave onMoveCommitted awaiting a promise that never resolves.
	 */
	private regenerateMap(): void {
		if (this.mercenary.isAnimating) return;

		this.moveController.exit();
		this.moveButton.setActive(false);

		this.mapSeed = Math.floor(Math.random() * 1_000_000);
		this.grid = this.buildMap();
		this.mercState = this.spawnMercenary();
		this.movementRemaining = this.mercState.stats.speed;

		// Fresh map = fresh turn
		this.hasMovedThisTurn = false;
		this.moveButton.setEnabled(true);

		// Replace the mercenary token
		this.mercenaryContainer.removeChildren();
		this.mercenary = new Mercenary(this.mercState.coord);
		this.mercenaryContainer.addChild(this.mercenary.view);

		// Re-create controller with new grid + mercenary references
		this.boardContainer.removeChild(this.moveController.view);
		this.moveController = this.createMoveController();
		this.boardContainer.addChild(this.moveController.view);

		this.renderMap();
		this.centerCameraOnMap();
		this.refreshStatsText();
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

	/** Anchor the Move button to the bottom-left of the screen. */
	private positionMoveButton(): void {
		this.moveButton.view.x = 20;
		this.moveButton.view.y = this.game.app.screen.height - 60;
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
		this.refreshStatsText();
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

	/** Snap the camera to the middle of the map. */
	private centerCameraOnMap(): void {
		const bounds = this.boardContainer.getLocalBounds();
		this.camera.centerOn(
			{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	/** Rebuild the debug/stats overlay text. */
	private refreshStatsText(): void {
		this.statsText.text = [
			`Map: ${this.MAP_WIDTH}x${this.MAP_HEIGHT} Rooms: ${this.ROOM_COUNT} Seed: ${this.mapSeed}`,
			`Tiles: ${this.tileCount} Gen: ${this.lastGenerationMs.toFixed(1)}ms Build: ${this.lastRenderMs.toFixed(1)}ms`,
			`FPS: ${Math.round(this.game.app.ticker.FPS)}`,
			`Movement: ${this.movementRemaining}  |  Move used: ${this.hasMovedThisTurn ? "YES" : "no"}`,
			`[Move] aim · click confirm · [Esc] cancel · [E] end turn · [R] regenerate`,
		].join("\n");
	}
}
