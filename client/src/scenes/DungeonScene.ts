import { Container, Graphics } from "pixi.js";
import type { Scene } from "../core/Scene";
import type { Game } from "../core/Game";
import {
	generateDungeon,
	Grid,
	TileType,
	type GridCoord,
} from "@relic-hunter/shared";

/**
 * DungeonScene renders the grid using isometric projection.
 *
 * This is the first real visual scene that uses the shared Grid data.
 * It demonstrates the full pipeline: shared data → isometric math → Pixi rendering.
 */
export class DungeonScene implements Scene {
	readonly view = new Container();

	private grid: Grid;
	private boardContainer = new Container();

	// Tile dimensions — these are rendering-specific constants.
	// Eventually we should move them to a shared constants file
	// (e.g. client/src/constants/rendering.ts) so other scenes can use the same values.
	private readonly TILE_WIDTH = 64;
	private readonly TILE_HEIGHT = 32;
	private readonly ZOOM = 0.8;

	private readonly TILE_COLORS: Record<TileType, number> = {
		[TileType.Floor]: 0x3a3a3a,
		[TileType.Wall]: 0x1a1a1a,
		[TileType.Exit]: 0xd4af37,
	};

	constructor(private game: Game) {
		this.grid = this.buildTestGrid();
		this.view.addChild(this.boardContainer);
	}

	onEnter(): void {
		this.renderGrid();
		this.boardContainer.scale.set(this.ZOOM);
		this.centerBoard();
	}

	onExit(): void {
		this.boardContainer.removeChildren();
	}

	update(_deltaTime: number): void {
		// No per-frame logic yet (movement/animation will go here later)
	}

	onResize(): void {
		this.centerBoard();
	}

	/**
	 * Creates a small test grid with some walls and an exit.
	 * This is temporary — real dungeon generation will replace this.
	 */

	private buildTestGrid(): Grid {
		return generateDungeon(24, 24, { seed: 1337, roomCount: 8 });
	}

	// old grid, for testing
	// private buildTestGrid(): Grid {
	// 	const grid = new Grid(8, 8);
	// 	grid.setTileType({ x: 3, y: 2 }, TileType.Wall);
	// 	grid.setTileType({ x: 3, y: 3 }, TileType.Wall);
	// 	grid.setTileType({ x: 3, y: 4 }, TileType.Wall);
	// 	grid.setTileType({ x: 7, y: 7 }, TileType.Exit);
	// 	return grid;
	// }

	/**
	 * Converts grid coordinates to screen (pixel) coordinates using isometric projection.
	 *
	 * This is the key math that gives the diagonal "from above" look.
	 */
	private gridToScreen(coord: GridCoord): { x: number; y: number } {
		return {
			x: (coord.x - coord.y) * (this.TILE_WIDTH / 2),
			y: (coord.x + coord.y) * (this.TILE_HEIGHT / 2),
		};
	}

	/**
	 * Renders every tile in the grid as a diamond shape.
	 * Clears previous tiles first so we can safely re-render if the grid changes.
	 */
	private renderGrid(): void {
		this.boardContainer.removeChildren();

		for (let x = 0; x < this.grid.width; x++) {
			for (let y = 0; y < this.grid.height; y++) {
				const tile = this.grid.getTile({ x, y });
				if (!tile) continue;

				const screenPos = this.gridToScreen(tile.coord);
				const diamond = this.drawTileDiamond(this.TILE_COLORS[tile.type]);

				diamond.x = screenPos.x;
				diamond.y = screenPos.y;
				this.boardContainer.addChild(diamond);
			}
		}
	}

	/**
	 * Draws a single isometric diamond tile using Graphics.
	 * Uses a polygon with 4 points to create the diamond shape.
	 */
	private drawTileDiamond(color: number): Graphics {
		const g = new Graphics();

		g.poly([
			0,
			-this.TILE_HEIGHT / 2, // Top
			this.TILE_WIDTH / 2,
			0, // Right`
			0,
			this.TILE_HEIGHT / 2, // Bottom
			-this.TILE_WIDTH / 2,
			0, // Left
		]);

		g.fill(color);
		g.stroke({ width: 1, color: 0x000000, alpha: 0.3 });

		return g;
	}

	/**
	 * Centers the entire board on screen.
	 * Uses boardContainer so we can move the whole grid as one unit.
	 * Now also uses local bounds + calculation to account for the zoom
	 */
	private centerBoard(): void {
		const bounds = this.boardContainer.getLocalBounds();
		const screenWidth = this.game.app.screen.width;
		const screenHeight = this.game.app.screen.height;

		const boundsCenterX = bounds.x + bounds.width / 2;
		const boundsCenterY = bounds.y + bounds.height / 2;

		this.boardContainer.x = screenWidth / 2 - boundsCenterX * this.ZOOM;
		this.boardContainer.y = screenHeight / 2 - boundsCenterY * this.ZOOM;
	}
}
