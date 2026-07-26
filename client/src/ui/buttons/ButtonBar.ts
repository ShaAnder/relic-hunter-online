import { Container, Graphics } from "pixi.js";
import { MoveButton } from "./MoveButton";
import { ActionButton } from "./ActionButton";
import { EndTurnButton } from "./EndTurnButton";
import type { TurnManager } from "@/systems/TurnManager";

export type ButtonAction =
	| "move"
	| "attack"
	| "rest"
	| "disengage"
	| "endTurn"
	| null;

const BTN_W = 100;
const BTN_H = 40;
const GAP = 20;

/**
 * Horizontal Move / Action / End Turn row sitting above CharacterPanel.
 * AP label removed — now lives inside CharacterPanel.
 * Action submenu opens upward.
 * @author ShaAnder
 */
export class ButtonBar {
	readonly view = new Container();

	private moveButton: MoveButton;
	private actionButton: ActionButton;
	private endTurnButton: EndTurnButton;
	private bg = new Graphics();

	constructor() {
		this.moveButton = new MoveButton();
		this.actionButton = new ActionButton();
		this.endTurnButton = new EndTurnButton();

		this.actionButton.setSubmenuDirection("up");

		this.moveButton.view.x = 0;
		this.actionButton.view.x = BTN_W + GAP;
		this.endTurnButton.view.x = (BTN_W + GAP) * 2;

		const totalWidth = BTN_W * 3 + GAP * 2;
		this.bg.roundRect(-8, -8, totalWidth + 16, BTN_H + 16, 10);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.9 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		this.view.addChild(this.moveButton.view);
		this.view.addChild(this.actionButton.view);
		this.view.addChild(this.endTurnButton.view);
	}

	/** Place the row directly above the CharacterPanel. */

	layout(characterY: number): void {
		this.view.x = 16;
		this.view.y = characterY - BTN_H - 2;
	}

	sync(tm: TurnManager): void {
		this.moveButton.setEnabled(tm.canMove);
		this.actionButton.setAttackEnabled(tm.canAttack);
		this.actionButton.setRestEnabled(tm.canRest);
		this.actionButton.setDisengageEnabled(tm.canDisengage);
	}

	closeMenu(): void {
		this.actionButton.closeMenu();
	}

	handleClick(screenX: number, screenY: number): ButtonAction {
		const localX = screenX - this.view.x;
		const localY = screenY - this.view.y;

		if (this.endTurnButton.hitTest(localX, localY)) return "endTurn";
		if (this.actionButton.hitTestAttack(localX, localY)) return "attack";
		if (this.actionButton.hitTestRest(localX, localY)) return "rest";
		if (this.actionButton.hitTestDisengage(localX, localY)) return "disengage";

		if (this.actionButton.hitTestMain(localX, localY)) {
			this.actionButton.toggleMenu();
			return null;
		}

		if (this.moveButton.hitTest(localX, localY)) return "move";
		return null;
	}

	setMoveActive(active: boolean): void {
		this.moveButton.setActive(active);
	}
}
