import { Container, Graphics, Text } from "pixi.js";
import type { MatchLogEntry } from "@/core/game/GameSession";

const PANEL_W = 280;
const PANEL_H = 320;
const ROW_H = 22;
const PAD = 10;
const VISIBLE_ROWS = Math.floor((PANEL_H - PAD * 2 - 30) / ROW_H);

/**
 * Scrollable match log — every event GameSession.matchLog has recorded,
 * newest at top. Hidden by default, toggled via the Logs button.
 * @author ShaAnder
 */
export class LogPanel {
	readonly view = new Container();

	private bg = new Graphics();
	private titleText: Text;
	private rowsContainer = new Container();
	private scrollOffset = 0;
	private open = false;
	private currentEntries: MatchLogEntry[] = [];

	constructor() {
		this.bg.roundRect(0, 0, PANEL_W, PANEL_H, 8);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.95 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.bg.eventMode = "static";
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

		this.bg.on("wheel", (e: WheelEvent) => {
			this.scrollOffset = Math.max(
				0,
				this.scrollOffset + (e.deltaY > 0 ? 1 : -1),
			);
			this.renderRows();
		});

		this.view.visible = false;
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
