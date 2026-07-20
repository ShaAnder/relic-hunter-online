import { Container, Graphics, Text } from "pixi.js";

const BTN_WIDTH = 100;
const BTN_HEIGHT = 40;
const SUB_WIDTH = 100;
const SUB_HEIGHT = 36;
const SUB_GAP = 4;

/**
 * The Action button and its three sub-options: Attack, Rest, Disengage.
 *
 * Clicking the main button toggles the sub-menu open/closed. Each sub-option
 * can be individually enabled or disabled by TurnManager state. Disabled
 * sub-options are greyed and fail hitTest so clicks fall through cleanly.
 *
 * Sub-menu direction is configurable — defaults to opening upward, switches
 * to leftward when hosted in a right-edge sidebar via setSubmenuDirection().
 * Spec: `05-turn-ap-system-design.md §The Two Buttons`
 */
export class ActionButton {
	readonly view = new Container();

	// Main button visuals + state
	private mainBg = new Graphics();
	private mainLabel: Text;
	private menuOpen = false;

	// Sub-menu container (shown/hidden)
	private subMenu = new Container();

	// Sub-option enabled state
	private attackEnabled = true;
	private restEnabled = true;
	private disengageEnabled = true;

	// Sub-option backgrounds (stored for hit-testing and redraw)
	private attackBg = new Graphics();
	private restBg = new Graphics();
	private disengageBg = new Graphics();

	// Sub-option labels (stored for repositioning on direction change)
	private attackLabel!: Text;
	private restLabel!: Text;
	private disengageLabel!: Text;

	// Which direction the sub-menu expands
	private submenuDirection: "up" | "left" | "right" = "up";

	constructor() {
		// Main button label
		this.mainLabel = new Text({
			text: "Action",
			style: { fill: 0xffffff, fontSize: 16, fontWeight: "bold" },
		});
		this.mainLabel.anchor.set(0.5);
		this.mainLabel.x = BTN_WIDTH / 2;
		this.mainLabel.y = BTN_HEIGHT / 2;

		this.view.addChild(this.mainBg);
		this.view.addChild(this.mainLabel);

		// Sub-menu built hidden, added on top so it renders above the map
		this.buildSubMenu();
		this.subMenu.visible = false;
		this.view.addChild(this.subMenu);

		this.redrawMain();
	}

	/** Toggle the sub-menu open or closed. */
	toggleMenu(): void {
		this.menuOpen = !this.menuOpen;
		this.subMenu.visible = this.menuOpen;
		this.redrawMain();
	}

	/** Close the sub-menu — call on scene exit, Esc, or after any action. */
	closeMenu(): void {
		this.menuOpen = false;
		this.subMenu.visible = false;
		this.redrawMain();
	}

	/** Enable or grey out the Attack sub-option. */
	setAttackEnabled(enabled: boolean): void {
		this.attackEnabled = enabled;
		this.redrawSub(this.attackBg, enabled);
	}

	/** Enable or grey out the Rest sub-option. */
	setRestEnabled(enabled: boolean): void {
		this.restEnabled = enabled;
		this.redrawSub(this.restBg, enabled);
	}

	/** Enable or grey out the Disengage sub-option. */
	setDisengageEnabled(enabled: boolean): void {
		this.disengageEnabled = enabled;
		this.redrawSub(this.disengageBg, enabled);
	}

	/**
	 * Set which direction the sub-menu expands and reposition items.
	 * "left" for right-edge sidebars, "right" for left-edge sidebars.
	 */
	setSubmenuDirection(dir: "up" | "left" | "right"): void {
		this.submenuDirection = dir;
		this.repositionSubMenu();
	}

	/** Hit test for the main Action button. */
	hitTestMain(screenX: number, screenY: number): boolean {
		return this.hitTestRect(screenX, screenY, 0, 0, BTN_WIDTH, BTN_HEIGHT);
	}

	/** Hit test for the Attack sub-option. Returns false if disabled or menu closed. */
	hitTestAttack(screenX: number, screenY: number): boolean {
		if (!this.menuOpen || !this.attackEnabled) return false;
		const { x, y } = this.subItemPosition(2);
		return this.hitTestRect(screenX, screenY, x, y, SUB_WIDTH, SUB_HEIGHT);
	}

	/** Hit test for the Rest sub-option. Returns false if disabled or menu closed. */
	hitTestRest(screenX: number, screenY: number): boolean {
		if (!this.menuOpen || !this.restEnabled) return false;
		const { x, y } = this.subItemPosition(1);
		return this.hitTestRect(screenX, screenY, x, y, SUB_WIDTH, SUB_HEIGHT);
	}

	/** Hit test for the Disengage sub-option. Returns false if disabled or menu closed. */
	hitTestDisengage(screenX: number, screenY: number): boolean {
		if (!this.menuOpen || !this.disengageEnabled) return false;
		const { x, y } = this.subItemPosition(0);
		return this.hitTestRect(screenX, screenY, x, y, SUB_WIDTH, SUB_HEIGHT);
	}

	// ---------- private ----------

	/** Build the three sub-menu option backgrounds and labels. */
	private buildSubMenu(): void {
		const items: Array<{ bg: Graphics; label: Text; text: string }> = [
			{
				bg: this.disengageBg,
				label: (this.disengageLabel = new Text({
					text: "Disengage (1AP)",
					style: { fill: 0xffffff, fontSize: 13 },
				})),
				text: "Disengage (1AP)",
			},
			{
				bg: this.restBg,
				label: (this.restLabel = new Text({
					text: "Rest (1AP)",
					style: { fill: 0xffffff, fontSize: 13 },
				})),
				text: "Rest (1AP)",
			},
			{
				bg: this.attackBg,
				label: (this.attackLabel = new Text({
					text: "Attack (2AP)",
					style: { fill: 0xffffff, fontSize: 13 },
				})),
				text: "Attack (2AP)",
			},
		];

		items.forEach(({ bg, label }) => {
			label.anchor.set(0.5);
			this.redrawSub(bg, true);
			this.subMenu.addChild(bg);
			this.subMenu.addChild(label);
		});

		// Position items for the default "up" direction
		this.repositionSubMenu();
	}

	/**
	 * Position sub-menu items for the current direction.
	 * "up" — items stack above the main button (index 0 closest).
	 * "left" — items stack to the left, vertically from top.
	 */
	private repositionSubMenu(): void {
		const bgs = [this.disengageBg, this.restBg, this.attackBg];
		const labels = [this.disengageLabel, this.restLabel, this.attackLabel];

		bgs.forEach((bg, i) => {
			const { x, y } = this.subItemPosition(i);
			bg.x = x;
			bg.y = y;
		});

		labels.forEach((label, i) => {
			if (!label) return;
			const { x, y } = this.subItemPosition(i);
			label.x = x + SUB_WIDTH / 2;
			label.y = y + SUB_HEIGHT / 2;
		});
	}

	/**
	 * Calculate background position for a sub-item at the given index.
	 * Index 0 = closest to the button in both directions.
	 */
	private subItemPosition(index: number): { x: number; y: number } {
		if (this.submenuDirection === "left") {
			return {
				x: -(SUB_WIDTH + SUB_GAP),
				y: index * (SUB_HEIGHT + SUB_GAP),
			};
		}
		if (this.submenuDirection === "right") {
			return {
				x: BTN_WIDTH + SUB_GAP,
				y: index * (SUB_HEIGHT + SUB_GAP),
			};
		}
		// Default: upward stack
		return {
			x: 0,
			y: -(SUB_HEIGHT + SUB_GAP) * (index + 1),
		};
	}

	/** Redraw a sub-option background in enabled or greyed state. */
	private redrawSub(bg: Graphics, enabled: boolean): void {
		bg.clear();
		bg.roundRect(0, 0, SUB_WIDTH, SUB_HEIGHT, 5);
		if (enabled) {
			bg.fill(0x2a2a2a);
			bg.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
		} else {
			bg.fill(0x1a1a1a);
			bg.stroke({ width: 2, color: 0x555555, alpha: 0.4 });
		}
	}

	/** Redraw the main button reflecting open/closed state. */
	private redrawMain(): void {
		this.mainBg.clear();
		this.mainBg.roundRect(0, 0, BTN_WIDTH, BTN_HEIGHT, 6);
		if (this.menuOpen) {
			this.mainBg.fill(0xffaa00);
			this.mainBg.stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
		} else {
			this.mainBg.fill(0x2a2a2a);
			this.mainBg.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
		}
	}

	/** Screen-space rectangle hit test accounting for this view's position. */
	private hitTestRect(
		screenX: number,
		screenY: number,
		localX: number,
		localY: number,
		w: number,
		h: number,
	): boolean {
		const ox = screenX - this.view.x;
		const oy = screenY - this.view.y;
		return ox >= localX && ox <= localX + w && oy >= localY && oy <= localY + h;
	}
}
