import { Container, Graphics } from "pixi.js";
import type { GridCoord } from "@relic-hunter/shared";
import { gridToScreen } from "@/math/isoGridMath";

/**
 * Placeholder visual for a chest sitting on the map — a closed box shape
 * that flips to an "opened" look and stops blocking further interaction
 * once collected. No sprite yet; swap the two drawn states for real art
 * later without touching anything that owns/places chests.
 */
export class Chest {
	readonly view = new Container();

	private box = new Graphics();
	private _isOpen = false;

	constructor(coord: GridCoord) {
		const pos = gridToScreen(coord);
		this.view.x = pos.x;
		this.view.y = pos.y;
		this.view.addChild(this.box);
		this.redraw();
	}

	get isOpen(): boolean {
		return this._isOpen;
	}

	/** Flip to the opened visual state. No-ops if already open. */
	open(): void {
		if (this._isOpen) return;
		this._isOpen = true;
		this.redraw();
	}

	/** Draw the closed (gold box) or opened (dim, lid-off) placeholder shape. */
	private redraw(): void {
		this.box.clear();

		const width = 26;
		const height = 20;

		if (this._isOpen) {
			// Opened: dim outline only, reads as "already looted"
			this.box.roundRect(-width / 2, -height, width, height, 4);
			this.box.stroke({ width: 2, color: 0x6b5a2a, alpha: 0.6 });
			return;
		}

		// Closed: solid gold box with a darker lid line
		this.box.roundRect(-width / 2, -height, width, height, 4);
		this.box.fill(0xd4af37);
		this.box.stroke({ width: 2, color: 0x000000, alpha: 0.5 });

		this.box.moveTo(-width / 2, -height * 0.6);
		this.box.lineTo(width / 2, -height * 0.6);
		this.box.stroke({ width: 2, color: 0x000000, alpha: 0.4 });
	}
}
