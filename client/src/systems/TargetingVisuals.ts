import { Container, Graphics } from "pixi.js";
import type * as RH from "@relic-hunter/shared";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";

/**
 * Purely visual attack-targeting elements — the adjacency-highlight
 * tiles and the gold reticle over a hovered/engaged target. Owns no
 * decision state; whether targeting mode is even active is genuinely
 * MapScene's own concern, since input handling, camera locking, and
 * Escape-key behavior all need to read that flag directly.
 * @author ShaAnder
 */
export class TargetingVisuals {
	readonly reticleView = new Graphics();
	readonly attackRangeView = new Container();

	constructor() {
		this.reticleView.visible = false;
	}

	/** Highlights every tile in adjacentCoords as a valid attack target. */
	showRange(adjacentCoords: RH.GridCoord[]): void {
		this.attackRangeView.removeChildren();
		for (const coord of adjacentCoords) {
			const pos = gridToScreen(coord);
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
			g.fill({ color: 0xffd700, alpha: 0.35 });
			g.x = pos.x;
			g.y = pos.y;
			this.attackRangeView.addChild(g);
		}
	}

	clearRange(): void {
		this.attackRangeView.removeChildren();
	}

	/** Points the shared marker at any entity's token — used by the player's manual targeting, and by any AI/monster/boss engagement preview. */
	showMarker(target: { view: { x: number; y: number } }): void {
		this.reticleView.visible = true;
		this.reticleView.clear();
		this.reticleView.poly([0, 0, 8, -12, -8, -12]);
		this.reticleView.fill(0xffd700);
		this.reticleView.x = target.view.x;
		this.reticleView.y = target.view.y - 50;
	}

	hideMarker(): void {
		this.reticleView.visible = false;
	}
}
