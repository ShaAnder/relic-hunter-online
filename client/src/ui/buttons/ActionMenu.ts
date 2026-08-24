import { Container } from "pixi.js";
import { Button, type ButtonConfig } from "@/ui/generics/Button";
import type { TurnManager } from "@/systems/TurnManager";

export type ButtonAction =
	| "move"
	| "attack"
	| "rest"
	| "disengage"
	| "special"
	| "endTurn"
	| null;

export type RowKey = ButtonAction | "actions";

interface Row {
	key: RowKey;
	button: Button;
}

const ROW_W = 130;
const ROW_H = 40;
const ROW_GAP = 8;
const MARGIN = 24;

/**
 * Two-tier action menu — the mobile/readability-first replacement for
 * the old radial wheel. A small, always-visible main menu (Move,
 * Actions, End Turn) sits bottom-right; pressing "Actions" pops a
 * submenu (Attack, Special, Disengage, Rest) out to its left. Same
 * public API as the old wheel (layout, sync, handleClick,
 * setMoveActive, closeMenu, update, view), so MapScene needed only
 * its import and constructor call changed.
 * @author ShaAnder
 */
export class ActionMenu {
	readonly view = new Container();

	private mainRows: Row[] = [];
	private subRows: Row[] = [];
	private specialRow!: Row;
	private submenuOpen = false;

	constructor() {
		this.mainRows.push(this.buildRow("move", "Move"));
		this.mainRows.push(this.buildRow("actions", "Actions"));
		this.mainRows.push(
			this.buildRow("endTurn", "End Turn", {
				bgColor: 0x1b5e20,
				activeColor: 0x2e7d32,
			}),
		);

		this.subRows.push(this.buildRow("attack", "Attack"));
		this.specialRow = this.buildRow("special", "Special");
		this.subRows.push(this.specialRow);
		this.subRows.push(this.buildRow("disengage", "Disengage"));
		this.subRows.push(this.buildRow("rest", "Rest"));

		this.setSubmenuVisible(false);
	}

	/**
	 * Color overrides passed as a real, optional object — not individual
	 * optional params spread directly into ButtonConfig. Button's own
	 * constructor does `{...defaults, ...config}`; a param that's merely
	 * `undefined` still exists as a key once spread into an object
	 * literal, which overwrites the default with `undefined` rather than
	 * leaving it untouched — this was the actual cause of the all-white
	 * button bug, not the stroke.
	 */
	private buildRow(
		key: RowKey,
		label: string,
		colors?: Pick<ButtonConfig, "bgColor" | "activeColor">,
	): Row {
		const button = new Button({
			text: label,
			width: ROW_W,
			height: ROW_H,
			fontSize: 15,
			...colors,
		});
		this.view.addChild(button.view);
		return { key, button };
	}

	/** Actually closes the submenu now — the existing "close after picking an action" call sites in MapScene work unmodified. */
	closeMenu(): void {
		this.setSubmenuVisible(false);
	}

	update(_deltaTime: number): void {}

	layout(screenWidth: number, screenHeight: number, s: number): void {
		const rowH = ROW_H * s;
		const gap = ROW_GAP * s;
		const rowW = ROW_W * s;
		const margin = MARGIN * s;

		const mainTotalH =
			this.mainRows.length * rowH + (this.mainRows.length - 1) * gap;
		const mainX = screenWidth - rowW - margin;
		let y = screenHeight - mainTotalH - margin;

		for (const row of this.mainRows) {
			row.button.view.scale.set(s);
			row.button.view.x = mainX;
			row.button.view.y = y;
			y += rowH + gap;
		}

		const subTotalH =
			this.subRows.length * rowH + (this.subRows.length - 1) * gap;
		const subX = mainX - rowW - gap;
		let subY = screenHeight - subTotalH - margin;

		for (const row of this.subRows) {
			row.button.view.scale.set(s);
			row.button.view.x = subX;
			row.button.view.y = subY;
			subY += rowH + gap;
		}
	}

	setMoveActive(active: boolean): void {
		const moveRow = this.mainRows.find((r) => r.key === "move");
		moveRow?.button.setActive(active);
	}

	/** specialAvailable is null when the current class has no special at all — the row is fully hidden in that case, not just dimmed. */
	sync(tm: TurnManager, specialAvailable: { apCost: number } | null): void {
		this.setEnabledFor("move", tm.canMove);
		this.setEnabledFor("attack", tm.canAttack);
		this.setEnabledFor("rest", tm.canRest);
		this.setEnabledFor("disengage", tm.canDisengage);
		this.setEnabledFor("endTurn", true);

		this.specialRow.button.view.visible =
			specialAvailable !== null && this.submenuOpen;
		if (specialAvailable !== null) {
			this.setEnabledFor("special", tm.canSpecial(specialAvailable.apCost));
		}
	}

	private setEnabledFor(key: RowKey, enabled: boolean): void {
		const row = [...this.mainRows, ...this.subRows].find((r) => r.key === key);
		row?.button.setEnabled(enabled);
	}

	private setSubmenuVisible(open: boolean): void {
		this.submenuOpen = open;
		const actionsRow = this.mainRows.find((r) => r.key === "actions");
		actionsRow?.button.setActive(open);
		for (const row of this.subRows) {
			row.button.view.visible = open;
		}
	}

	/** Manual bounds hit-test, not Button's own onClick — MapScene routes clicks through its own DOM-level handler, not PixiJS's pointer system. "Actions" toggles the submenu internally and always returns null, since it isn't a real game action. */
	handleClick(screenX: number, screenY: number): ButtonAction {
		for (const row of this.mainRows) {
			if (!row.button.view.visible) continue;
			if (this.hitTest(row, screenX, screenY)) {
				if (row.key === "actions") {
					this.setSubmenuVisible(!this.submenuOpen);
					return null;
				}
				return row.key as ButtonAction;
			}
		}

		if (this.submenuOpen) {
			for (const row of this.subRows) {
				if (!row.button.view.visible) continue;
				if (this.hitTest(row, screenX, screenY)) return row.key as ButtonAction;
			}
		}

		return null;
	}

	private hitTest(row: Row, screenX: number, screenY: number): boolean {
		const b = row.button.view.getBounds();
		return (
			screenX >= b.x &&
			screenX <= b.x + b.width &&
			screenY >= b.y &&
			screenY <= b.y + b.height
		);
	}

	/** Global center of a specific button, or null if it doesn't exist or is currently hidden (e.g. a submenu row while the submenu is closed) — used by tutorial UI pointers. */
	getButtonScreenPosition(key: RowKey): { x: number; y: number } | null {
		const row = [...this.mainRows, ...this.subRows].find((r) => r.key === key);
		if (!row || !row.button.view.visible) return null;
		const b = row.button.view.getBounds();
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	}
}
