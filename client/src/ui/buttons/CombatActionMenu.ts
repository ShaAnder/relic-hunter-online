import { Container } from "pixi.js";
import { Button } from "@/ui/generics/Button";
import type { CombatAction } from "@relic-hunter/shared";

const ROW_W = 160;
const ROW_H = 40;
const ROW_GAP = 8;

const ACTION_ORDER: CombatAction[] = ["attack", "defend", "run", "surrender"];

const ACTION_LABELS: Record<CombatAction, string> = {
	attack: "Attack",
	defend: "Defend",
	run: "Run",
	surrender: "Surrender",
};

const ACTION_COLORS: Partial<
	Record<CombatAction, { bgColor: number; activeColor: number }>
> = {
	attack: { bgColor: 0x5c1a1a, activeColor: 0xe74c3c },
	defend: { bgColor: 0x5c4a1a, activeColor: 0xf1c40f },
	run: { bgColor: 0x1a3a5c, activeColor: 0x3498db },
	surrender: { bgColor: 0x3a3a3a, activeColor: 0x95a5a6 },
};

export class CombatActionMenu {
	readonly view = new Container();

	private rows: { action: CombatAction; button: Button }[] = [];
	onAction: ((action: CombatAction) => void) | null = null;

	setActions(actions: CombatAction[]): void {
		for (const row of this.rows) {
			this.view.removeChild(row.button.view);
		}
		this.rows = [];

		const ordered = ACTION_ORDER.filter((a) => actions.includes(a));
		for (const action of ordered) {
			const colors = ACTION_COLORS[action];
			const button = new Button({
				text: ACTION_LABELS[action],
				width: ROW_W,
				height: ROW_H,
				fontSize: 15,
				...(colors ?? {}),
				onClick: () => this.onAction?.(action),
			});
			this.view.addChild(button.view);
			this.rows.push({ action, button });
		}
	}

	layoutAbovePanel(
		panelX: number,
		panelY: number,
		panelW: number,
		s: number,
	): void {
		const rowH = ROW_H * s;
		const gap = ROW_GAP * s;
		const rowW = ROW_W * s;
		const totalH =
			this.rows.length * rowH + Math.max(0, this.rows.length - 1) * gap;

		const x = panelX + (panelW - rowW) / 2;
		let y = panelY - totalH - 12 * s;

		for (const row of this.rows) {
			row.button.view.scale.set(s);
			row.button.view.x = x;
			row.button.view.y = y;
			y += rowH + gap;
		}
	}

	setVisible(visible: boolean): void {
		this.view.visible = visible;
	}

	setDimmedExcept(action: CombatAction | null): void {
		for (const row of this.rows) {
			const focus = action === null || row.action === action;
			row.button.view.alpha = focus ? 1 : 0.35;
		}
	}

	setHighlighted(action: CombatAction | null): void {
		for (const row of this.rows) {
			row.button.setActive(action !== null && row.action === action);
		}
	}

	getButtonScreenPosition(
		action: CombatAction,
	): { x: number; y: number } | null {
		const row = this.rows.find((r) => r.action === action);
		if (!row || !row.button.view.visible || !this.view.visible) return null;
		const b = row.button.view.getBounds();
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	}
}
