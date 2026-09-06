import { Container, Graphics } from "pixi.js";
import type { Grid, TileType } from "@relic-hunter/shared";
import * as RH from "@relic-hunter/shared";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import type { CameraController } from "@/core/cameras/CameraController";
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

/** Alpha applied per fog tier — visible tiles render at full strength, explored-but-out-of-range tiles are dimmed (still readable, clearly stale), unseen tiles are nearly invisible rather than fully removed (keeps the board's overall shape legible instead of a jarring void). */
const FOG_ALPHA: Record<RH.TileVisibility, number> = {
	visible: 1,
	explored: 0.45,
	unseen: 0.06,
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
	/** Each tile's own Graphics, keyed by coord — kept around so fog visibility can update alpha per-tile without rebuilding the whole grid every time a unit moves. */
	private tileGraphics = new Map<string, Graphics>();

	constructor(
		private tilesContainer: Container,
		private boardContainer: Container,
		private camera: CameraController,
		private game: Game,
	) {}

	/**
	 * Clear and redraw all tile graphics for the given grid.
	 * Returns timing stats for the debug overlay.
	 */
	build(grid: Grid, generationMs: number): MapRenderStats {
		const start = performance.now();
		this.tilesContainer.removeChildren();
		this.tileGraphics.clear();

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
				this.tileGraphics.set(RH.coordKey(tile.coord), diamond);
			}
		}

		return {
			tileCount: count,
			generationMs,
			renderMs: performance.now() - start,
		};
	}

	/**
	 * Sets every tile's alpha per the three-tier fog model for one
	 * unit's own fog memory — call whenever that unit's position or
	 * turn count changes (after a move, at turn end), not every frame;
	 * a full grid pass every frame is unnecessary work maps this size
	 * don't need.
	 */
	updateFogVisibility(
		fog: RH.HasFogOfWar,
		center: RH.GridCoord,
		currentTurn: number,
	): void {
		for (const [key, graphic] of this.tileGraphics) {
			const [x, y] = key.split(",").map(Number);
			const visibility = RH.getTileVisibility(
				fog,
				{ x, y },
				center,
				currentTurn,
			);
			graphic.alpha = FOG_ALPHA[visibility];
		}
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
