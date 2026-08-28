import { Container, Graphics, Text } from "pixi.js";
import type { MatchLogEntry } from "@/core/game/GameSession";
import { pointInContainer } from "@/rendering/HitTest";
import type { ScrollSurface } from "@/input/GestureRouter";

const PANEL_W = 280;
const PANEL_H = 320;
const ROW_H = 22;
const PAD = 10;
const VISIBLE_ROWS = Math.floor((PANEL_H - PAD * 2 - 30) / ROW_H);

/**
 * Scrollable match log — every event GameSession.matchLog has recorded,
 * newest at top. Hidden by default, toggled via the Logs button.
 * Implements ScrollSurface — GestureRouter owns dispatch, not Pixi's
 * own event system, so the camera can never receive a gesture this
 * panel already claimed.
 * @author ShaAnder
 */
export class LogPanel implements ScrollSurface {
	readonly view = new Container();
	private bg = new Graphics();
	private titleText: Text;
	private rowsContainer = new Container();
	private clipMask = new Graphics();
	private scrollOffset = 0;
	private open = false;
	private currentEntries: MatchLogEntry[] = [];

	constructor() {
		this.bg.roundRect(0, 0, PANEL_W, PANEL_H, 8);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.95 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		this.titleText = new Text({
			text: "Match Log",
			style: { fill: 0xffffff, fontSize: 14, fontWeight: "bold" },
		});
		this.titleText.x = PAD;
		this.titleText.y = 8;
		this.view.addChild(this.titleText);

		this.rowsContainer.x = PAD;
		this.rowsContainer.y = 32;
		this.view.addChild(this.rowsContainer);
		this.clipMask.rect(0, 0, PANEL_W, PANEL_H - 32 - PAD);
		this.clipMask.fill(0xffffff);
		this.clipMask.x = PAD;
		this.clipMask.y = 32;
		this.view.addChild(this.clipMask);
		this.rowsContainer.mask = this.clipMask;

		this.view.visible = false;
	}

	/** False when closed — a hidden panel must never claim a gesture just because the pointer happens to be where it would render. */
	hitTest(screenX: number, screenY: number): boolean {
		if (!this.open) return false;
		return pointInContainer(screenX, screenY, this.view);
	}

	/** Wheel-down (positive deltaY) moves further into the log — same convention the old handler used.
	 * Always consumes; GestureRouter only calls this once hitTest already passed. */
	handleWheel(deltaY: number): boolean {
		this.scrollOffset = Math.max(0, this.scrollOffset + Math.sign(deltaY));
		this.renderRows();
		return true;
	}

	/** Content follows the finger — dragging up (negative deltaY) scrolls further into the log,
	 * the opposite sign from handleWheel's native deltaY convention. */
	handleDrag(_deltaX: number, deltaY: number): boolean {
		this.scrollOffset = Math.max(0, this.scrollOffset - Math.sign(deltaY));
		this.renderRows();
		return true;
	}

	sync(entries: MatchLogEntry[]): void {
		this.currentEntries = entries;
		this.renderRows();
	}

	toggle(): void {
		this.open = !this.open;
		this.view.visible = this.open;
		if (this.open) this.scrollOffset = 0;
	}

	get isOpen(): boolean {
		return this.open;
	}

	layout(x: number, y: number): void {
		this.view.x = x;
		this.view.y = y;
	}

	private renderRows(): void {
		this.rowsContainer.removeChildren();

		const ordered = [...this.currentEntries].reverse();
		const maxOffset = Math.max(0, ordered.length - VISIBLE_ROWS);
		this.scrollOffset = Math.min(this.scrollOffset, maxOffset);

		const slice = ordered.slice(
			this.scrollOffset,
			this.scrollOffset + VISIBLE_ROWS,
		);

		let cursorY = 0;
		const ROW_GAP = 6;

		for (const entry of slice) {
			const time = new Date(entry.timestamp).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
			const row = new Text({
				text: `[${time}] ${entry.message}`,
				style: {
					fill: 0xcccccc,
					fontSize: 11,
					wordWrap: true,
					wordWrapWidth: PANEL_W - PAD * 2,
				},
			});
			row.y = cursorY;
			this.rowsContainer.addChild(row);
			cursorY += row.height + ROW_GAP;
		}
	}
}
