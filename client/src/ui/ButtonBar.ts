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

const SIDEBAR_MARGIN = 16;
const BTN_GAP = 12;
const BTN_HEIGHT = 40;
const SIDEBAR_PADDING = 16;
const LABEL_HEIGHT = 28;

// Total bar height: label + 3 buttons + 2 gaps, plus padding top and bottom
const BAR_CONTENT_HEIGHT =
	LABEL_HEIGHT + BTN_HEIGHT * 3 + BTN_GAP * 2 + SIDEBAR_PADDING * 2;

/**
 * Vertical sidebar housing all turn-control buttons: Move, Action (with
 * Attack / Rest / Disengage sub-menu), and End Turn.
 *
 * ButtonBar owns layout, hit testing, and visual state sync. MapScene
 * calls handleClick() on every canvas click and receives a ButtonAction —
 * it never touches individual buttons directly.
 *
 * Anchored mid-left of the screen. All child button hit tests operate in
 * bar-local coordinates, so handleClick() translates screen coords by the
 * bar's own position before delegating — child buttons never need to know
 * where the bar sits on screen.
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

		// Sub-menu opens rightward from a left-anchored sidebar
		this.actionButton.setSubmenuDirection("right");

		this.view.addChild(this.apLabel);
		this.view.addChild(this.moveButton.view);
		this.view.addChild(this.actionButton.view);
		this.view.addChild(this.endTurnButton.view);
	}

	/**
	 * Anchor the sidebar to the left edge, vertically centered.
	 * Call from MapScene.onEnter() and onResize().
	 */
	resize(_screenWidth: number, screenHeight: number): void {
		this.view.x = SIDEBAR_MARGIN;
		this.view.y = Math.max(0, (screenHeight - BAR_CONTENT_HEIGHT) / 2);
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
	 * Translates screen coords into bar-local space first — child hit tests
	 * subtract only their own local position within the bar.
	 */
	handleClick(screenX: number, screenY: number): ButtonAction {
		const localX = screenX - this.view.x;
		const localY = screenY - this.view.y;

		// End Turn first — always available
		if (this.endTurnButton.hitTest(localX, localY)) return "endTurn";

		// Sub-options before main so open menu items take priority
		if (this.actionButton.hitTestAttack(localX, localY)) return "attack";
		if (this.actionButton.hitTestRest(localX, localY)) return "rest";
		if (this.actionButton.hitTestDisengage(localX, localY)) return "disengage";

		// Main Action button — toggle only, no action returned
		if (this.actionButton.hitTestMain(localX, localY)) {
			this.actionButton.toggleMenu();
			return null;
		}

		if (this.moveButton.hitTest(localX, localY)) return "move";

		return null;
	}

	/** Set Move button active/inactive highlight. */
	setMoveActive(active: boolean): void {
		this.moveButton.setActive(active);
	}

	// ---------- private ----------

	/** Stack buttons vertically below the AP label. */
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
