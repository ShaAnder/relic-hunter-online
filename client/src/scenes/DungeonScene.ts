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
import { Mercenary } from "../entities/mercenary";
import {
	Grid,
	TileType,
	type GridCoord,
	generateDungeon,
	findFirstWalkableTile,
	createMercenary,
	type MercenaryState,
	computeMovementRange,
	getPathTo,
	type MovementRangeEntry,
} from "@relic-hunter/shared";

/**
 * DungeonScene renders the grid using isometric projection.
 *
 * This is the first real visual scene that uses the shared Grid data.
 * It demonstrates the full pipeline: shared data → isometric math → Pixi rendering.
 */
export class DungeonScene implements Scene {
	readonly view = new Container();

	// grid board and tiles
	private grid: Grid;
	private boardContainer = new Container();
	private tilesContainer = new Container();

	// mercenary objects
	private movementRangeContainer = new Container();
	private mercenaryContainer = new Container();

	// camera and stats objects
	private camera: Camera;
	private statsText: Text;

	// Dimensions of the dungeon in tiles.
	private readonly DUNGEON_WIDTH = 50;
	private readonly DUNGEON_HEIGHT = 50;

	// Controls how many rooms get generated based on map size.
	private readonly ROOM_DENSITY = 1 / 50;
	private readonly ROOM_COUNT = Math.floor(
		this.DUNGEON_WIDTH * this.DUNGEON_HEIGHT * this.ROOM_DENSITY,
	);

	// Seed used for dungeon generation. Changing this produces a different map.
	private dungeonSeed = 133283;

	// Color mapping for different tile types.
	private readonly TILE_COLORS: Record<TileType, number> = {
		[TileType.Floor]: 0x3a3a3a,
		[TileType.Wall]: 0x1a1a1a,
		[TileType.Exit]: 0xd4af37,
	};

	// set our mercenary and movement
	private mercState!: MercenaryState;
	private merc!: Mercenary;
	private movementRemaining = 0;
	private movementRange: Map<string, MovementRangeEntry> | null = null;

	// Performance tracking variables.
	private tileCount = 0;
	private lastGenerationMs = 0;
	private lastRenderMs = 0;
	private fpsRefreshAccumulator = 0;

	constructor(private game: Game) {
		// init dungeon and add the board to the view
		this.grid = this.buildDungeon();
		this.boardContainer.addChild(this.tilesContainer);
		this.boardContainer.addChild(this.movementRangeContainer);
		this.boardContainer.addChild(this.mercenaryContainer);
		this.view.addChild(this.boardContainer);

		// Initialize the camera and pass it the boardContainer
		this.camera = new Camera(this.boardContainer, {
			initialZoom: 1.75,
			minZoom: 0.75,
			maxZoom: 3,
			panSpeed: 700,
		});

		// Create the stats text in the top-left corner.
		this.statsText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 14, fontFamily: "monospace" },
		});
		this.statsText.x = 12;
		this.statsText.y = 12;
		this.view.addChild(this.statsText);

		// init our mercenaries
		this.mercState = this.spawnMerc();
		this.movementRemaining = this.mercState.stats.speed;
		this.merc = new Mercenary(this.mercState.coord);
		this.mercenaryContainer.addChild(this.merc.view);
	}

	onEnter(): void {
		// Draw all the tiles for the first time.
		this.renderGrid();
		this.recomputeMovementRange();
		this.renderMovementRange();
		this.centerCameraOnBoard();

		this.camera.attach(this.game.app.canvas);
		window.addEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.addEventListener("click", this.handleClick);
	}

	onExit(): void {
		// Clean up tile graphics and camera listeners when leaving the scene.
		this.boardContainer.removeChildren();
		this.camera.detach(this.game.app.canvas);
		window.removeEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.removeEventListener("click", this.handleClick);
	}

	update(deltaTime: number): void {
		// Update camera position and zoom based on input.
		this.camera.update(
			deltaTime,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		this.merc.update(deltaTime);

		// Refresh the stats text roughly twice per second.
		this.fpsRefreshAccumulator += deltaTime;
		if (this.fpsRefreshAccumulator >= 30) {
			this.fpsRefreshAccumulator = 0;
			this.refreshStatsText();
		}
	}

	onResize(): void {
		// Intentionally left empty.
		// We do not want to fight the player’s current camera position on resize.
	}

	private buildDungeon(): Grid {
		// Record start time for performance measurement.
		const start = performance.now();

		// Generate the grid data.
		const grid = generateDungeon(this.DUNGEON_WIDTH, this.DUNGEON_HEIGHT, {
			seed: this.dungeonSeed,
			roomCount: this.ROOM_COUNT,
		});

		// Store how long generation took.
		this.lastGenerationMs = performance.now() - start;

		return grid;
	}

	// spawn our mercenary on the first walkable tile with some basic stats for now
	// stats will be determined by level / equips later
	private spawnMerc(): MercenaryState {
		const spawnCoord = findFirstWalkableTile(this.grid) ?? { x: 0, y: 0 };
		return createMercenary("player", spawnCoord, {
			speed: 4,
			attack: 3,
			defense: 2,
			maxHp: 20,
		});
	}

	private recomputeMovementRange(): void {
		this.movementRange = computeMovementRange(
			this.grid,
			this.mercState.coord,
			this.movementRemaining,
		);
	}

	private handleKeyDown = (event: KeyboardEvent): void => {
		// Regenerate the dungeon when R is pressed.
		if (event.key === "r" || event.key === "R") {
			this.dungeonSeed = Math.floor(Math.random() * 1_000_000);
			this.grid = this.buildDungeon();

			this.mercState = this.spawnMerc();
			this.movementRemaining = this.mercState.stats.speed;

			this.mercenaryContainer.removeChildren();
			this.merc = new Mercenary(this.mercState.coord);
			this.mercenaryContainer.addChild(this.merc.view);

			this.renderGrid();
			this.recomputeMovementRange();
			this.renderMovementRange();
			this.centerCameraOnBoard();
		}
	};

	private handleClick = (event: MouseEvent): void => {
		if (this.camera.isLocked) return;
		if (this.merc.isAnimating) return;

		const canvas = this.game.app.canvas;
		const rect = canvas.getBoundingClientRect();
		const screenX = event.clientX - rect.left;
		const screenY = event.clientY - rect.top;

		// Correct conversion that respects camera pan + zoom
		const local = this.boardContainer.toLocal({ x: screenX, y: screenY });
		const destination = screenToGrid(local.x, local.y);

		this.tryMoveMercTo(destination);
	};

	private async tryMoveMercTo(destination: GridCoord): Promise<void> {
		// check if movement range exists
		if (!this.movementRange) return;

		// get our path based on movement range
		const path = getPathTo(this.movementRange, destination);
		if (!path || path.length === 0) return;

		// set merc state coords and subtract from movement
		this.mercState.coord = destination;
		this.movementRemaining -= path.length;

		// clear highlight from tile while animating
		this.movementRangeContainer.removeChildren();

		await this.merc.moveAlongPath(path);

		this.recomputeMovementRange();
		this.renderMovementRange();
		this.refreshStatsText();
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

	private renderMovementRange(): void {
		this.movementRangeContainer.removeChildren();
		if (!this.movementRange) return;

		for (const entry of this.movementRange.values()) {
			if (entry.distance === 0) continue;

			// CRITICAL FIX: convert grid coord → screen position
			const screenPos = gridToScreen(entry.coord);

			const highlight = new Graphics();
			highlight.poly([
				0,
				-TILE_HEIGHT / 2,
				TILE_WIDTH / 2,
				0,
				0,
				TILE_HEIGHT / 2,
				-TILE_WIDTH / 2,
				0,
			]);
			highlight.fill({ color: 0x4a9eff, alpha: 0.35 });
			highlight.x = screenPos.x;
			highlight.y = screenPos.y;
			this.movementRangeContainer.addChild(highlight);
		}
	}

	private refreshStatsText(): void {
		// Update the on-screen stats text with current information.
		this.statsText.text = [
			`Map: ${this.DUNGEON_WIDTH}x${this.DUNGEON_HEIGHT} Rooms: ${this.ROOM_COUNT} Seed: ${this.dungeonSeed}`,
			`Tiles: ${this.tileCount}`,
			`Generation: ${this.lastGenerationMs.toFixed(1)}ms Tile-build: ${this.lastRenderMs.toFixed(1)}ms`,
			`FPS: ${Math.round(this.game.app.ticker.FPS)}`,
			`WASD pan · wheel zoom · [R] regenerate`,
		].join("\n");
	}

	private drawTileDiamond(color: number): Graphics {
		// Create a new Graphics object to draw one tile.
		const g = new Graphics();

		// Draw a diamond shape using four points (top, right, bottom, left).
		g.poly([
			0,
			-TILE_HEIGHT / 2, // Top
			TILE_WIDTH / 2,
			0, // Right
			0,
			TILE_HEIGHT / 2, // Bottom
			-TILE_WIDTH / 2,
			0, // Left
		]);

		g.fill(color);
		g.stroke({ width: 1, color: 0x000000, alpha: 0.3 });

		return g;
	}

	private centerCameraOnBoard(): void {
		// Get the bounding box of all the tiles that were just drawn.
		const bounds = this.boardContainer.getLocalBounds();

		// Calculate the center point of the entire drawn map.
		this.camera.centerOn(
			{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}
}
