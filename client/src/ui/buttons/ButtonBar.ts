import { Container } from "pixi.js";
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
const GAP = 10;

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

	constructor() {
		this.moveButton = new MoveButton();
		this.actionButton = new ActionButton();
		this.endTurnButton = new EndTurnButton();

		this.actionButton.setSubmenuDirection("up");

		this.moveButton.view.x = 0;
		this.actionButton.view.x = BTN_W + GAP;
		this.endTurnButton.view.x = (BTN_W + GAP) * 2;

		this.view.addChild(this.moveButton.view);
		this.view.addChild(this.actionButton.view);
		this.view.addChild(this.endTurnButton.view);
	}

	/** Place the row directly above the CharacterPanel. */
	layout(characterY: number): void {
		this.view.x = 16;
		this.view.y = characterY - BTN_H - 10;
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
