import { Container, Text } from "pixi.js";
import { MoveButton } from "./MoveButton";
import { ActionButton } from "./ActionButton";
import { EndTurnButton } from "./EndTurnButton";
import type { TurnManager } from "../systems/TurnManager";

/** Named actions returned from handleClick so MapScene switches on intent. */
export type ButtonAction =
	| "move"
	| "attack"
	| "rest"
	| "disengage"
	| "endTurn"
	| null;

const SIDEBAR_WIDTH = 120;
const BTN_GAP = 12;
const BTN_HEIGHT = 40;
const SIDEBAR_PADDING = 16;

/**
 * Vertical sidebar housing all turn-control buttons: Move, Action (with
 * Attack / Rest / Disengage sub-menu), and End Turn.
 *
 * ButtonBar owns layout, hit testing, and visual state sync. MapScene
 * calls handleClick() on every canvas click and receives a ButtonAction
 * string — it never touches individual buttons directly. This keeps all
 * button concerns out of the scene.
 *
 * Sidebar anchors to the right edge of the screen and is repositioned
 * via resize() whenever the canvas dimensions change.
 */
export class ButtonBar {
	readonly view = new Container();

	// Individual buttons
	private moveButton: MoveButton;
	private actionButton: ActionButton;
	private endTurnButton: EndTurnButton;

	// AP display label at top of sidebar
	private apLabel: Text;

	constructor() {
		this.moveButton = new MoveButton();
		this.actionButton = new ActionButton();
		this.endTurnButton = new EndTurnButton();

		// AP counter at top of bar
		this.apLabel = new Text({
			text: "AP: 3/3",
			style: { fill: 0xffffff, fontSize: 13, fontFamily: "monospace" },
		});
		this.apLabel.x = SIDEBAR_PADDING;
		this.apLabel.y = SIDEBAR_PADDING;

		this.layoutButtons();

		this.view.addChild(this.apLabel);
		this.view.addChild(this.moveButton.view);
		this.view.addChild(this.actionButton.view);
		this.view.addChild(this.endTurnButton.view);
	}

	/**
	 * Reposition the sidebar to the right edge of the screen.
	 * Call from MapScene.onEnter() and onResize().
	 */
	resize(screenWidth: number, screenHeight: number): void {
		this.view.x = screenWidth - SIDEBAR_WIDTH;
		this.view.y = 0;
		this.actionButton.setSubmenuDirection("left");
		void screenHeight;
	}

	/**
	 * Sync button enabled states from TurnManager.
	 * Call whenever TurnManager fires its onChanged callback.
	 */
	sync(tm: TurnManager): void {
		this.moveButton.setEnabled(tm.canMove);
		this.actionButton.setAttackEnabled(tm.canAttack);
		this.actionButton.setRestEnabled(tm.canRest);
		this.actionButton.setDisengageEnabled(tm.canDisengage);
		this.apLabel.text = `AP: ${tm.apRemaining}/${tm.baseAP}`;
	}

	/** Close the Action sub-menu — call on Esc, scene exit, and after any action. */
	closeMenu(): void {
		this.actionButton.closeMenu();
	}

	/**
	 * Hit test all buttons and return the matching ButtonAction, or null.
	 * MapScene passes every canvas click here before doing anything else.
	 */
	handleClick(screenX: number, screenY: number): ButtonAction {
		// End Turn first — always available
		if (this.endTurnButton.hitTest(screenX, screenY)) return "endTurn";

		// Sub-options before main so open menu items take priority
		if (this.actionButton.hitTestAttack(screenX, screenY)) return "attack";
		if (this.actionButton.hitTestRest(screenX, screenY)) return "rest";
		if (this.actionButton.hitTestDisengage(screenX, screenY))
			return "disengage";

		// Main Action button — toggle only, no action returned
		if (this.actionButton.hitTestMain(screenX, screenY)) {
			this.actionButton.toggleMenu();
			return null;
		}

		if (this.moveButton.hitTest(screenX, screenY)) return "move";

		return null;
	}

	/** Set Move button active/inactive highlight. */
	setMoveActive(active: boolean): void {
		this.moveButton.setActive(active);
	}

	// ---------- private ----------

	/** Stack buttons vertically below the AP label. */
	private layoutButtons(): void {
		const startY = SIDEBAR_PADDING + 28;
		const step = BTN_HEIGHT + BTN_GAP;

		this.moveButton.view.x = SIDEBAR_PADDING;
		this.moveButton.view.y = startY;

		this.actionButton.view.x = SIDEBAR_PADDING;
		this.actionButton.view.y = startY + step;

		this.endTurnButton.view.x = SIDEBAR_PADDING;
		this.endTurnButton.view.y = startY + step * 2;
	}
}
