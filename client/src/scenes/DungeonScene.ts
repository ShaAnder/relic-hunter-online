import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "../core/Scene";
import type { Game } from "../core/Game";
import { Camera } from "../core/Camera";
import {
	Grid,
	TileType,
	type GridCoord,
	generateDungeon,
} from "@relic-hunter/shared";

/**
 * DungeonScene renders the grid using isometric projection.
 *
 * This is the first real visual scene that uses the shared Grid data.
 * It demonstrates the full pipeline: shared data → isometric math → Pixi rendering.
 */
export class DungeonScene implements Scene {
	readonly view = new Container();

	// The grid data structure that holds all tile information (walls, floors, exit, etc.)
	private grid: Grid;

	// Container that holds all the visual tile graphics. This is what gets panned and zoomed.
	private boardContainer = new Container();

	// Camera controller responsible for panning and zooming the boardContainer.
	private camera: Camera;

	// Text object that displays performance stats and controls in the top-left corner.
	private statsText: Text;

	// Width and height of each isometric tile in pixels.
	private readonly TILE_WIDTH = 64;
	private readonly TILE_HEIGHT = 32;

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

	// Performance tracking variables.
	private tileCount = 0;
	private lastGenerationMs = 0;
	private lastRenderMs = 0;
	private fpsRefreshAccumulator = 0;

	constructor(private game: Game) {
		// Generate the dungeon data using the procedural generator.
		this.grid = this.buildDungeon();

		// Add the container that will hold all tile graphics.
		this.view.addChild(this.boardContainer);

		// Initialize the camera and pass it the boardContainer so it can move and scale it.
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
	}

	onEnter(): void {
		// Draw all the tiles for the first time.
		this.renderGrid();

		// Center the camera on the generated map.
		this.centerCameraOnBoard();

		// Attach camera input listeners (mouse drag + wheel).
		this.camera.attach(this.game.app.canvas);

		// Listen for the R key to regenerate the dungeon.
		window.addEventListener("keydown", this.handleKeyDown);
	}

	onExit(): void {
		// Clean up tile graphics and camera listeners when leaving the scene.
		this.boardContainer.removeChildren();
		this.camera.detach(this.game.app.canvas);
		window.removeEventListener("keydown", this.handleKeyDown);
	}

	update(deltaTime: number): void {
		// Update camera position and zoom based on input.
		this.camera.update(
			deltaTime,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);

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

	private handleKeyDown = (event: KeyboardEvent): void => {
		// Regenerate the dungeon when R is pressed.
		if (event.key === "r" || event.key === "R") {
			this.dungeonSeed = Math.floor(Math.random() * 1_000_000);
			this.grid = this.buildDungeon();
			this.renderGrid();
			this.centerCameraOnBoard();
		}
	};

	/**
	 * Converts a grid coordinate into screen pixel coordinates.
	 * Uses the standard isometric projection formula.
	 */
	private gridToScreen(coord: GridCoord): { x: number; y: number } {
		// Isometric projection math.
		// x position moves right when x increases and left when y increases.
		// y position moves down when either x or y increases.
		return {
			x: (coord.x - coord.y) * (this.TILE_WIDTH / 2),
			y: (coord.x + coord.y) * (this.TILE_HEIGHT / 2),
		};
	}

	private renderGrid(): void {
		// Record start time for performance measurement.
		const start = performance.now();

		// Clear any previously drawn tiles.
		this.boardContainer.removeChildren();

		let count = 0;

		// Loop through every tile position in the grid.
		for (let x = 0; x < this.grid.width; x++) {
			for (let y = 0; y < this.grid.height; y++) {
				// Get the tile data at this position.
				const tile = this.grid.getTile({ x, y });
				if (!tile) continue;

				count++;

				// Convert grid position to screen position.
				const screenPos = this.gridToScreen(tile.coord);

				// Create the visual diamond for this tile.
				const diamond = this.drawTileDiamond(this.TILE_COLORS[tile.type]);
				diamond.x = screenPos.x;
				diamond.y = screenPos.y;

				// Add the tile graphic to the board container.
				this.boardContainer.addChild(diamond);
			}
		}

		// Store performance data.
		this.tileCount = count;
		this.lastRenderMs = performance.now() - start;

		// Update the stats display immediately after rendering.
		this.refreshStatsText();
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
		// The points are calculated using TILE_WIDTH and TILE_HEIGHT to maintain the isometric ratio.
		g.poly([
			0,
			-this.TILE_HEIGHT / 2, // Top point of the diamond
			this.TILE_WIDTH / 2,
			0, // Right point of the diamond
			0,
			this.TILE_HEIGHT / 2, // Bottom point of the diamond
			-this.TILE_WIDTH / 2,
			0, // Left point of the diamond
		]);

		// Fill the diamond with the appropriate color.
		g.fill(color);

		// Add a subtle dark outline so adjacent tiles are easier to distinguish.
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
