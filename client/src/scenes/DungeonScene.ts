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

export class DungeonScene implements Scene {
	readonly view = new Container();

	private grid: Grid;
	private boardContainer = new Container();
	private tilesContainer = new Container();
	private mercenaryContainer = new Container();

	private camera: Camera;
	private statsText: Text;
	private moveButton: MoveButton;
	private moveController: MoveController;

	private readonly DUNGEON_WIDTH = 50;
	private readonly DUNGEON_HEIGHT = 50;
	private readonly ROOM_DENSITY = 1 / 50;
	private readonly ROOM_COUNT = Math.floor(
		this.DUNGEON_WIDTH * this.DUNGEON_HEIGHT * this.ROOM_DENSITY,
	);
	private dungeonSeed = 42;

	private readonly TILE_COLORS: Record<TileType, number> = {
		[TileType.Floor]: 0x3a3a3a,
		[TileType.Wall]: 0x1a1a1a,
		[TileType.Exit]: 0xd4af37,
	};

	private mercState: MercenaryState;
	private mercenary: Mercenary;
	private movementRemaining = 0;

	private tileCount = 0;
	private lastGenerationMs = 0;
	private lastRenderMs = 0;
	private fpsRefreshAccumulator = 0;

	constructor(private game: Game) {
		this.grid = this.buildDungeon();

		this.boardContainer.addChild(this.tilesContainer);
		this.boardContainer.addChild(this.mercenaryContainer);
		this.view.addChild(this.boardContainer);

		this.camera = new Camera(this.boardContainer, {
			initialZoom: 1.75,
			minZoom: 0.75,
			maxZoom: 3,
			panSpeed: 700,
		});

		this.mercState = this.spawnMercenary();
		this.movementRemaining = this.mercState.stats.speed;
		this.mercenary = new Mercenary(this.mercState.coord);
		this.mercenaryContainer.addChild(this.mercenary.view);

		// MoveController owns range + path preview rendering
		this.moveController = new MoveController({
			grid: this.grid,
			camera: this.camera,
			mercenary: this.mercenary,
			getMercenaryCoord: () => this.mercState.coord,
			getMovementRemaining: () => this.movementRemaining,
			onMoveCommitted: (target, path) => this.onMoveCommitted(target, path),
		});
		this.boardContainer.addChild(this.moveController.view);

		this.statsText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 14, fontFamily: "monospace" },
		});
		this.statsText.x = 12;
		this.statsText.y = 12;
		this.view.addChild(this.statsText);

		this.moveButton = new MoveButton();
		this.view.addChild(this.moveButton.view);
		this.positionMoveButton();
	}

	onEnter(): void {
		this.renderGrid();
		this.centerCameraOnBoard();
		this.camera.attach(this.game.app.canvas);

		window.addEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.addEventListener("click", this.handleClick);
		this.game.app.canvas.addEventListener("mousemove", this.handleMouseMove);
	}

	onExit(): void {
		this.moveController.exit();
		this.boardContainer.removeChildren();
		this.camera.detach(this.game.app.canvas);
		window.removeEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.removeEventListener("click", this.handleClick);
		this.game.app.canvas.removeEventListener("mousemove", this.handleMouseMove);
	}

	update(deltaTime: number): void {
		this.camera.update(
			deltaTime,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		this.mercenary.update(deltaTime);

		this.fpsRefreshAccumulator += deltaTime;
		if (this.fpsRefreshAccumulator >= 30) {
			this.fpsRefreshAccumulator = 0;
			this.refreshStatsText();
		}
	}

	onResize(): void {
		this.positionMoveButton();
	}

	// ---------- Move mode integration ----------

	private async onMoveCommitted(
		target: GridCoord,
		path: GridCoord[],
	): Promise<void> {
		this.mercState.coord = target;
		this.movementRemaining -= path.length;

		// Clear visuals immediately
		this.moveController.exit();

		await this.mercenary.moveAlongPath(path);
		this.refreshStatsText();
	}

	// ---------- Input ----------

	private handleKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			this.moveController.exit();
			this.moveButton.setActive(false);
			return;
		}

		if (event.key === "r" || event.key === "R") {
			this.moveController.exit();
			this.moveButton.setActive(false);

			this.dungeonSeed = Math.floor(Math.random() * 1_000_000);
			this.grid = this.buildDungeon();
			this.mercState = this.spawnMercenary();
			this.movementRemaining = this.mercState.stats.speed;

			this.mercenaryContainer.removeChildren();
			this.mercenary = new Mercenary(this.mercState.coord);
			this.mercenaryContainer.addChild(this.mercenary.view);

			// Re-create controller with new grid reference
			this.boardContainer.removeChild(this.moveController.view);
			this.moveController = new MoveController({
				grid: this.grid,
				camera: this.camera,
				mercenary: this.mercenary,
				getMercenaryCoord: () => this.mercState.coord,
				getMovementRemaining: () => this.movementRemaining,
				onMoveCommitted: (target, path) => this.onMoveCommitted(target, path),
			});
			this.boardContainer.addChild(this.moveController.view);

			this.renderGrid();
			this.centerCameraOnBoard();
			this.refreshStatsText();
		}
	};

	private handleClick = (event: MouseEvent): void => {
		const { screenX, screenY } = this.getScreenPoint(event);

		// Toggle Move button
		if (this.moveButton.hitTest(screenX, screenY)) {
			if (this.moveController.active) {
				this.moveController.exit();
				this.moveButton.setActive(false);
			} else {
				this.moveController.enter();
				this.moveButton.setActive(true);
			}
			return;
		}

		// Commit move if in move mode
		if (this.moveController.active) {
			this.moveController.tryCommit();
		}
	};

	private handleMouseMove = (event: MouseEvent): void => {
		if (!this.moveController.active) return;

		const { screenX, screenY } = this.getScreenPoint(event);
		const hovered = this.screenPointToGrid(screenX, screenY);
		this.moveController.onHover(hovered);
	};

	// ---------- Helpers ----------

	private getScreenPoint(event: MouseEvent) {
		const rect = this.game.app.canvas.getBoundingClientRect();
		return {
			screenX: event.clientX - rect.left,
			screenY: event.clientY - rect.top,
		};
	}

	private screenPointToGrid(screenX: number, screenY: number): GridCoord {
		const localX =
			(screenX - this.boardContainer.x) / this.boardContainer.scale.x;
		const localY =
			(screenY - this.boardContainer.y) / this.boardContainer.scale.y;
		return screenToGrid(localX, localY);
	}

	private positionMoveButton(): void {
		this.moveButton.view.x = 20;
		this.moveButton.view.y = this.game.app.screen.height - 60;
	}

	private buildDungeon(): Grid {
		const start = performance.now();
		const grid = generateDungeon(this.DUNGEON_WIDTH, this.DUNGEON_HEIGHT, {
			seed: this.dungeonSeed,
			roomCount: this.ROOM_COUNT,
		});
		this.lastGenerationMs = performance.now() - start;
		return grid;
	}

	private spawnMercenary(): MercenaryState {
		const spawnCoord = findFirstWalkableTile(this.grid) ?? { x: 0, y: 0 };
		return createMercenary("player", spawnCoord, {
			speed: 4,
			attack: 3,
			defense: 2,
			maxHp: 20,
		});
	}

	private renderGrid(): void {
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

	private centerCameraOnBoard(): void {
		const bounds = this.boardContainer.getLocalBounds();
		this.camera.centerOn(
			{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	private refreshStatsText(): void {
		this.statsText.text = [
			`Map: ${this.DUNGEON_WIDTH}x${this.DUNGEON_HEIGHT} Rooms: ${this.ROOM_COUNT} Seed: ${this.dungeonSeed}`,
			`Tiles: ${this.tileCount} Gen: ${this.lastGenerationMs.toFixed(1)}ms Build: ${this.lastRenderMs.toFixed(1)}ms`,
			`FPS: ${Math.round(this.game.app.ticker.FPS)}`,
			`Movement remaining: ${this.movementRemaining}`,
			`[Move] to aim · click tile to confirm · [Esc] cancel · [R] regenerate`,
		].join("\n");
	}
}
