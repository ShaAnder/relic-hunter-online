import { Container, Graphics } from "pixi.js";
import type { Grid, TileType } from "@relic-hunter/shared";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import type { Camera } from "@/core/cameras/Camera";
import type { Game } from "@/core/game/Game";

/** Timing stats returned after a build so the scene can display them. */
export interface MapRenderStats {
	tileCount: number;
	generationMs: number;
	renderMs: number;
}

const TILE_COLORS: Record<TileType, number> = {
	floor: 0x3a3a3a,
	wall: 0x1a1a1a,
	exit: 0xd4af37,
};

/**
 * Handles all grid rendering for a battle map: building tile graphics,
 * drawing iso diamond shapes, and centering the camera on the board.
 *
 * Pure rendering concern — holds no game state. Accepts a Grid and writes
 * into the provided Container. MapScene calls build() on enter and on
 * [R] regen; nothing else in the scene touches tile graphics.
 *
 * Designed to work with any map type (dungeon, arena, town, overworld) —
 * the tile color palette is the only battle-specific thing here, and that
 * will eventually be driven by map config rather than hardcoded.
 */
export class MapRenderer {
	constructor(
		private tilesContainer: Container,
		private boardContainer: Container,
		private camera: Camera,
		private game: Game,
	) {}

	/**
	 * Clear and redraw all tile graphics for the given grid.
	 * Returns timing stats for the debug overlay.
	 */
	build(grid: Grid, generationMs: number): MapRenderStats {
		const start = performance.now();
		this.tilesContainer.removeChildren();

		let count = 0;
		for (let x = 0; x < grid.width; x++) {
			for (let y = 0; y < grid.height; y++) {
				const tile = grid.getTile({ x, y });
				if (!tile) continue;
				count++;

				const screenPos = gridToScreen(tile.coord);
				const diamond = this.drawTileDiamond(TILE_COLORS[tile.type]);
				diamond.x = screenPos.x;
				diamond.y = screenPos.y;
				this.tilesContainer.addChild(diamond);
			}
		}

		return {
			tileCount: count,
			generationMs,
			renderMs: performance.now() - start,
		};
	}

	/** Snap the camera to the centre of the map after a build or regen. */
	centerCamera(): void {
		const bounds = this.boardContainer.getLocalBounds();
		this.camera.centerOn(
			{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
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
}
