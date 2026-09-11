import { Container, Graphics } from "pixi.js";
import type { Grid, TileType } from "@relic-hunter/shared";
import * as RH from "@relic-hunter/shared";
import {
	gridToScreen,
	TILE_WIDTH,
	TILE_HEIGHT,
	ELEVATION_PX_PER_UNIT,
} from "@/math/isoGridMath";
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
export const FOG_ALPHA: Record<RH.TileVisibility, number> = {
	visible: 1,
	explored: 0.45,
	unseen: 0.06,
};

/** Elevation at or above which a tile is tall enough to actually occlude a character standing near it — low walls (0.5-0.9) still visually read as "behind cover," not "hidden," so only the full-height tier fades. */
const OCCLUSION_ELEVATION_THRESHOLD = 1;

/** Screen-pixel radius of the fade effect around the character, roughly a tile and a half — close enough that only walls genuinely near the character fade, not the whole visible board. */
const OCCLUSION_FADE_RADIUS = 140;

/** The lowest alpha a fading wall drops to, right at the character's own position — never fully invisible, so the wall's presence stays legible even while faded. */
const OCCLUSION_MIN_ALPHA = 0.25;

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
	/** Each tile's own fog-tier alpha, tracked separately from graphic.alpha — occlusion fade multiplies on top of this without ever losing what fog itself actually says, so a wall moving out of fade range restores to the correct fog state exactly, not some approximation. */
	private baseFogAlpha = new Map<string, number>();
	/** Ground-level screen position of every tile tall enough to occlude a character (full-height walls and equivalent) — only this small subset needs a distance check each frame, not all ~1,600 tiles on the board. */
	private occlusionCandidates = new Map<string, { x: number; y: number }>();

	constructor(
		private tilesContainer: Container,
		private boardContainer: Container,
		private camera: CameraController,
		private game: Game,
	) {}

	/**
	 * Clear and redraw all tile graphics for the given grid. `elevation`
	 * is optional per-tile height data (coordKey -> elevation, in
	 * character-height terms per elevation-rules.md) — when supplied,
	 * each tile's screen position rises proportionally and gains shaded
	 * side faces, so raised ground and low walls read as actual raised
	 * blocks rather than flat tiles. Returns timing stats for the debug
	 * overlay.
	 */
	build(
		grid: Grid,
		generationMs: number,
		elevation?: Map<string, number>,
		stairsTiles?: Set<string>,
	): MapRenderStats {
		const start = performance.now();
		this.tilesContainer.removeChildren();
		this.tileGraphics.clear();
		this.baseFogAlpha.clear();
		this.occlusionCandidates.clear();

		let count = 0;
		for (let x = 0; x < grid.width; x++) {
			for (let y = 0; y < grid.height; y++) {
				const tile = grid.getTile({ x, y });
				if (!tile) continue;
				count++;

				const key = RH.coordKey(tile.coord);
				const screenPos = gridToScreen(tile.coord);
				const tileElevation = this.readElevation(elevation, key);
				const elevationPx = tileElevation * ELEVATION_PX_PER_UNIT;

				const diamond = stairsTiles?.has(key)
					? this.drawStairsTile(elevationPx)
					: this.drawTileDiamond(TILE_COLORS[tile.type], elevationPx);
				diamond.x = screenPos.x;
				diamond.y = screenPos.y - elevationPx;
				this.tilesContainer.addChild(diamond);
				this.tileGraphics.set(key, diamond);

				if (
					tile.type === "wall" &&
					tileElevation >= OCCLUSION_ELEVATION_THRESHOLD
				) {
					this.occlusionCandidates.set(key, screenPos);
				}
			}
		}

		return {
			tileCount: count,
			generationMs,
			renderMs: performance.now() - start,
		};
	}

	/** Elevation to use for a tile: the supplied value if present and finite, otherwise 0 — Void/River carry Infinity in the data (they're never walkable at all, height is meaningless for them), which would otherwise send the tile flying off screen. */
	private readElevation(
		elevation: Map<string, number> | undefined,
		key: string,
	): number {
		const value = elevation?.get(key);
		if (value === undefined || !Number.isFinite(value)) return 0;
		return value;
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
			this.baseFogAlpha.set(key, FOG_ALPHA[visibility]);
			graphic.alpha = this.computeDisplayedAlpha(key);
		}
	}

	/**
	 * Fades tall walls near the given screen position — the local
	 * player's own character, always, per the current scope — so a
	 * character standing behind a full-height wall stays visible
	 * through it rather than being hidden behind an always-on-top
	 * wall graphic. The fade is strongest exactly at the character's
	 * position and falls off smoothly to no effect at
	 * OCCLUSION_FADE_RADIUS, the classic "circle of transparency
	 * centered on the player" RPG occlusion effect — not a full
	 * depth-sort of tiles against characters, which this deliberately
	 * avoids as a much larger rendering change. Only checks the small
	 * set of tall-wall tiles gathered in build(), not the whole board,
	 * so this is cheap enough to call every frame from update() and
	 * track smooth, mid-animation movement rather than snapping only
	 * at discrete tile steps. Pass null to clear any current fade
	 * (e.g. the local character's turn has ended, nothing to occlude
	 * for).
	 */
	updateWallOcclusion(
		characterScreenPos: { x: number; y: number } | null,
	): void {
		for (const [key, screenPos] of this.occlusionCandidates) {
			const graphic = this.tileGraphics.get(key);
			if (!graphic) continue;

			let fadeFactor = 1;
			if (characterScreenPos) {
				const dx = screenPos.x - characterScreenPos.x;
				const dy = screenPos.y - characterScreenPos.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (dist < OCCLUSION_FADE_RADIUS) {
					const t = dist / OCCLUSION_FADE_RADIUS; // 0 at character, 1 at radius edge
					fadeFactor = OCCLUSION_MIN_ALPHA + (1 - OCCLUSION_MIN_ALPHA) * t;
				}
			}

			const fogAlpha = this.baseFogAlpha.get(key) ?? 1;
			graphic.alpha = fogAlpha * fadeFactor;
		}
	}

	/** The actual alpha a tile displays outside of the per-frame occlusion pass — just its own fog alpha. updateWallOcclusion overwrites this for occlusion candidates each frame; this is what a fog-only update (a non-occluding tile, or no character position yet) falls back to. */
	private computeDisplayedAlpha(key: string): number {
		return this.baseFogAlpha.get(key) ?? 1;
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

	/**
	 * Build one iso diamond tile graphic in the given color, raised by
	 * elevationPx. When raised, also draws two shaded side faces (left
	 * and right, each a different shade so the block reads with real
	 * depth rather than a flat silhouette) connecting the top face down
	 * to ground level — the actual "block sitting above the ground"
	 * look, not just a diamond floating higher on screen.
	 */
	private drawTileDiamond(color: number, elevationPx: number): Graphics {
		const g = new Graphics();
		const top = { x: 0, y: -TILE_HEIGHT / 2 };
		const right = { x: TILE_WIDTH / 2, y: 0 };
		const bottom = { x: 0, y: TILE_HEIGHT / 2 };
		const left = { x: -TILE_WIDTH / 2, y: 0 };

		if (elevationPx > 0) {
			g.poly([
				left.x,
				left.y,
				bottom.x,
				bottom.y,
				bottom.x,
				bottom.y + elevationPx,
				left.x,
				left.y + elevationPx,
			]);
			g.fill(shadeColor(color, 0.55));

			g.poly([
				bottom.x,
				bottom.y,
				right.x,
				right.y,
				right.x,
				right.y + elevationPx,
				bottom.x,
				bottom.y + elevationPx,
			]);
			g.fill(shadeColor(color, 0.72));
		}

		g.poly([
			top.x,
			top.y,
			right.x,
			right.y,
			bottom.x,
			bottom.y,
			left.x,
			left.y,
		]);
		g.fill(color);
		g.stroke({ width: 1, color: 0x000000, alpha: 0.3 });
		return g;
	}

	/**
	 * Draws a stairs tile as a visible stepped slope — a small series
	 * of progressively-raised bands (each shaped to the diamond's own
	 * width at that depth, so steps don't overhang the tile's actual
	 * footprint) with a shaded riser face between each, rather than
	 * the single flat top every other tile gets. This is a visual
	 * prototype only: there's no second floor for the stairs to
	 * actually lead to yet, so the "climb" here is purely cosmetic —
	 * enough to see the shape before the real connection exists.
	 */
	private drawStairsTile(baseElevationPx: number): Graphics {
		const g = new Graphics();
		const halfW = TILE_WIDTH / 2;
		const halfH = TILE_HEIGHT / 2;
		const steps = 4;
		const totalRise = TILE_HEIGHT;
		const risePerStep = totalRise / steps;
		const stairsColor = 0xb4a028;

		for (let i = 0; i < steps; i++) {
			const y0 = halfH - (i / steps) * (2 * halfH);
			const y1 = halfH - ((i + 1) / steps) * (2 * halfH);
			const w0 = halfW * (1 - Math.abs(y0) / halfH);
			const w1 = halfW * (1 - Math.abs(y1) / halfH);
			const stepTop = baseElevationPx + i * risePerStep;
			const shadeFactor = 1 - i * 0.12;

			// Riser (the vertical-ish face connecting down from this
			// step to the one below) — drawn first so the tread sits
			// visually on top of it.
			g.poly([
				-w1,
				y1 - stepTop,
				w1,
				y1 - stepTop,
				w1,
				y1 - stepTop + risePerStep,
				-w1,
				y1 - stepTop + risePerStep,
			]);
			g.fill(shadeColor(stairsColor, shadeFactor * 0.6));

			// Tread (the flat part of the step you'd actually stand on).
			g.poly([
				-w0,
				y0 - stepTop,
				w0,
				y0 - stepTop,
				w1,
				y1 - stepTop,
				-w1,
				y1 - stepTop,
			]);
			g.fill(shadeColor(stairsColor, shadeFactor));
		}

		g.stroke({ width: 1, color: 0x000000, alpha: 0.3 });
		return g;
	}
}

/** Darkens a 0xRRGGBB color by `factor` (0-1, lower = darker) — used for a raised tile's side faces, so they read as shaded sides of a block rather than the same flat color as the top. */
function shadeColor(color: number, factor: number): number {
	const r = Math.floor(((color >> 16) & 0xff) * factor);
	const g = Math.floor(((color >> 8) & 0xff) * factor);
	const b = Math.floor((color & 0xff) * factor);
	return (r << 16) | (g << 8) | b;
}
