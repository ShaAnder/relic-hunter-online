import { Container, Text } from "pixi.js";
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

const SIDEBAR_MARGIN = 16;
const BTN_GAP = 12;
const BTN_HEIGHT = 40;
const SIDEBAR_PADDING = 16;
const LABEL_HEIGHT = 28;

const BAR_CONTENT_HEIGHT =
	LABEL_HEIGHT + BTN_HEIGHT * 3 + BTN_GAP * 2 + SIDEBAR_PADDING * 2;

/**
 * Vertical sidebar housing all turn-control buttons.
 * Public API is unchanged so MapScene requires zero changes.
 */
export class ButtonBar {
	readonly view = new Container();

	private moveButton: MoveButton;
	private actionButton: ActionButton;
	private endTurnButton: EndTurnButton;
	private apLabel: Text;

	constructor() {
		this.moveButton = new MoveButton();
		this.actionButton = new ActionButton();
		this.endTurnButton = new EndTurnButton();

		this.apLabel = new Text({
			text: "AP: 3/3",
			style: { fill: 0xffffff, fontSize: 13, fontFamily: "monospace" },
		});
		this.apLabel.x = SIDEBAR_PADDING;
		this.apLabel.y = SIDEBAR_PADDING;

		this.layoutButtons();
		this.actionButton.setSubmenuDirection("right");

		this.view.addChild(this.apLabel);
		this.view.addChild(this.moveButton.view);
		this.view.addChild(this.actionButton.view);
		this.view.addChild(this.endTurnButton.view);
	}

	resize(_screenWidth: number, screenHeight: number): void {
		this.view.x = SIDEBAR_MARGIN;
		this.view.y = Math.max(0, (screenHeight - BAR_CONTENT_HEIGHT) / 2);
	}

	sync(tm: TurnManager): void {
		this.moveButton.setEnabled(tm.canMove);
		this.actionButton.setAttackEnabled(tm.canAttack);
		this.actionButton.setRestEnabled(tm.canRest);
		this.actionButton.setDisengageEnabled(tm.canDisengage);
		this.apLabel.text = `AP: ${tm.apRemaining}/${tm.baseAP}`;
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

	private layoutButtons(): void {
		const startY = SIDEBAR_PADDING + LABEL_HEIGHT;
		const step = BTN_HEIGHT + BTN_GAP;

		this.moveButton.view.x = SIDEBAR_PADDING;
		this.moveButton.view.y = startY;

		this.actionButton.view.x = SIDEBAR_PADDING;
		this.actionButton.view.y = startY + step;

		this.endTurnButton.view.x = SIDEBAR_PADDING;
		this.endTurnButton.view.y = startY + step * 2;
	}
}
