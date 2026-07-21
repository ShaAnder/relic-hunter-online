import { Container, Graphics, Text } from "pixi.js";
import { Card, CardData, CARD_WIDTH, CARD_HEIGHT } from "@/entities/Card";

const CARET_PULSE_SPEED = 0.006; // radians per ms — tuned for a gentle bob
const CARET_PULSE_RANGE = 6; // pixels
const OVERLAY_DURATION_MS = 1500;

// Fan layout tuning — a wider spread or step reads as more "spread open"
const FAN_ROTATION_STEP = 0.09; // radians per card offset from center (~5°)
const FAN_X_STEP = 55; // horizontal spacing — tighter than CARD_WIDTH so cards overlap
const FAN_Y_RISE = 8; // px each card drops per offset unit from center
const HIGHLIGHT_LIFT = 34; // px the selected card slides outward along its fan angle
const CARET_GAP = 18; // px between a card's top edge and the caret

/** Reserved id for the permanent "No Card" option — never removed on play. */
const SKIP_CARD_ID = "__skip__";

/**
 * Renders the player's hand as a fanned arc (rotation + arc offset per
 * card, pivoting from the bottom-center of each card) and owns
 * card-selection during the Move action.
 *
 * A pulsing downward-pointing caret hovers over the currently highlighted
 * card, which lifts further above the fan and partially straightens — the
 * "pulled out of the hand" look. Cards that fail the current phase's filter
 * (e.g. Attack during Move, or a second blue card once one's been played)
 * are greyed and non-interactive. A permanent "No Card" slot always sits
 * at the fan's end — never disabled by the filter, never removed on play.
 *
 * Click and hover handlers are bound to each Card object directly rather
 * than a captured array index, and resolve their current position via
 * `indexOf()` at event time — this is what keeps clicks correct after a
 * card is removed and every card after it shifts down one slot.
 *
 * Spec: `04-card-system-design.md`
 */
export class Hand {
	readonly view = new Container();

	private cards: Card[] = [];
	private onCardConfirmed?: (card: CardData) => void;

	// Selection state
	private selecting = false;
	private highlightedIndex = -1;
	private selectableFilter: (data: CardData) => boolean = () => true;

	// Caret indicator
	private caret = new Container();
	private caretElapsedMs = 0;

	// Transient "card played" detail overlay
	private overlayBg = new Graphics();
	private overlayText: Text;
	private overlayTimerMs = 0;

	constructor(onCardConfirmed?: (card: CardData) => void) {
		this.onCardConfirmed = onCardConfirmed;

		this.buildCaret();
		this.caret.visible = false;
		this.view.addChild(this.caret);

		this.overlayText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 13, align: "center" },
		});
		this.overlayText.anchor.set(0.5, 0);
		this.view.addChild(this.overlayBg);
		this.view.addChild(this.overlayText);
		this.overlayBg.visible = false;
		this.overlayText.visible = false;
	}

	/** Whether card selection is currently active (a Move is in progress). */
	get isSelecting(): boolean {
		return this.selecting;
	}

	/**
	 * Build the starter hand plus the permanent skip slot.
	 * Cards start disabled until selection begins.
	 */
	initStarterHand(): void {
		this.clear();

		const starterCards: CardData[] = [
			// Blue — Movement (1-3, plus E which bypasses movement entirely)
			{
				id: "blue1",
				color: "blue",
				name: "Move +3",
				value: 3,
				description: "+3 Movement",
				actionType: "move",
			},
			{
				id: "blueE",
				color: "blue",
				name: "Exit (E)",
				value: "E",
				description:
					"Teleport to exit — wins if carrying the relic, otherwise random teleport",
				actionType: "move",
			},
			// Red — Attack (1-6, plus A/C which multiply the attack stat pre-defense)
			{
				id: "red1",
				color: "red",
				name: "Attack +5",
				value: 5,
				description: "+5 Attack",
				actionType: "attack",
			},
			{
				id: "redA",
				color: "red",
				name: "Double Dmg (A)",
				value: "A",
				description: "Attack stat ×2, applied before defense",
				actionType: "attack",
			},
			{
				id: "redC",
				color: "red",
				name: "Critical (C)",
				value: "C",
				description: "Attack stat ×1.5, applied before defense",
				actionType: "attack",
			},
			// Yellow — Defense (1-4, plus A/C special effects)
			{
				id: "yellow1",
				color: "yellow",
				name: "Def +4",
				value: 4,
				description: "+4 Defense",
				actionType: "defense",
			},
			{
				id: "yellowA",
				color: "yellow",
				name: "Nullify (A)",
				value: "A",
				description: "Negates the hit entirely, or instantly disarms a trap",
				actionType: "defense",
			},
			{
				id: "yellowC",
				color: "yellow",
				name: "Double Def (C)",
				value: "C",
				description:
					"Doubles defense this exchange — bypasses the attack-stance half rule",
				actionType: "defense",
			},
			// Green — Environment/Trap (Stun only for Phase 1)
			{
				id: "green1",
				color: "green",
				name: "Stun",
				value: 1,
				description: "Stun trap",
				actionType: "stun",
			},
			this.buildSkipCardData(),
		];

		starterCards.forEach((data) => {
			const card = new Card(data);
			// Resting state: full color, just not clickable until Move is pressed
			card.setInteractive(false);
			card.setGreyedOut(false);
			// Bottom-center pivot so rotation reads as fanning from a grip
			// point below the hand, not spinning around each card's corner
			card.view.pivot.set(CARD_WIDTH / 2, CARD_HEIGHT);
			this.cards.push(card);
			this.view.addChild(card.view);

			// Bound to the Card object, not a captured index — see file JSDoc
			card.view.on("pointerover", () => this.handlePointerOverCard(card));
			card.view.on("pointerdown", () => this.handlePointerDownCard(card));
		});

		this.layoutCards();
	}

	/**
	 * Begin card selection: grey out cards that fail the filter, highlight
	 * the first selectable card, and show the caret. The skip slot always
	 * passes regardless of filter. Call when Move is pressed.
	 */
	enterSelectionMode(filter: (data: CardData) => boolean): void {
		this.selectableFilter = filter;
		this.selecting = true;

		this.cards.forEach((card) => {
			const selectable = this.isSelectable(card);
			card.setInteractive(selectable);
			card.setGreyedOut(!selectable);
		});

		const firstSelectable = this.cards.findIndex((c) => this.isSelectable(c));
		this.highlightedIndex = firstSelectable;
		this.caret.visible = firstSelectable !== -1;
		this.applyHighlight();
	}

	/** Exit selection mode: hide the caret, return every card to full-color rest. */
	exitSelectionMode(): void {
		this.selecting = false;
		this.highlightedIndex = -1;
		this.caret.visible = false;
		this.cards.forEach((card) => {
			card.setHighlighted(false);
			card.setInteractive(false);
			card.setGreyedOut(false);
		});
		this.layoutCards();
	}

	/** Move the caret to the next selectable card in the given direction. */
	moveCaret(direction: 1 | -1): void {
		if (!this.selecting || this.cards.length === 0) return;

		const total = this.cards.length;
		let next = this.highlightedIndex;

		for (let i = 0; i < total; i++) {
			next = (next + direction + total) % total;
			if (this.isSelectable(this.cards[next])) {
				this.highlightedIndex = next;
				this.applyHighlight();
				return;
			}
		}
	}

	/** Play whichever card the caret currently rests on. */
	confirmHighlighted(): void {
		if (!this.selecting) return;
		if (this.highlightedIndex < 0 || this.highlightedIndex >= this.cards.length)
			return;
		this.playCard(this.cards[this.highlightedIndex]);
	}

	/** Per-frame tick: pulses the caret and counts down the played-card overlay. */
	update(deltaTime: number): void {
		const deltaMs = (deltaTime / 60) * 1000;

		if (this.caret.visible) {
			this.caretElapsedMs += deltaMs;
			const bob =
				Math.sin(this.caretElapsedMs * CARET_PULSE_SPEED) * CARET_PULSE_RANGE;
			this.positionCaret(bob);
		}

		if (this.overlayTimerMs > 0) {
			this.overlayTimerMs -= deltaMs;
			if (this.overlayTimerMs <= 0) {
				this.overlayBg.visible = false;
				this.overlayText.visible = false;
			}
		}
	}

	/** Position the hand at the bottom center of the screen. */
	resize(width: number, height: number): void {
		this.view.x = width / 2;
		this.view.y = height - 40;
		this.layoutCards();
	}

	getCards(): Card[] {
		return this.cards;
	}

	// ---------- private ----------

	/** Whether a card can be selected right now: skip is always eligible. */
	private isSelectable(card: Card): boolean {
		const data = card.getData();
		if (data.id === SKIP_CARD_ID) return true;
		return this.selectableFilter(data);
	}

	/** Mouse hover moves the caret while selection is active. Resolves the
	 *  card's CURRENT index via indexOf — never trust a captured index. */
	private handlePointerOverCard(card: Card): void {
		if (!this.selecting || !this.isSelectable(card)) return;
		const index = this.cards.indexOf(card);
		if (index === -1) return;
		this.highlightedIndex = index;
		this.applyHighlight();
	}

	/** Clicking a selectable card plays it immediately. */
	private handlePointerDownCard(card: Card): void {
		if (!this.selecting || !this.isSelectable(card)) return;
		this.playCard(card);
	}

	/**
	 * Play the given card: fire the effect callback, show the brief detail
	 * overlay, remove it (unless it's the permanent skip slot), and exit
	 * selection mode. Looks up the index fresh rather than trusting a
	 * value computed before this call.
	 */
	private playCard(card: Card): void {
		const data = card.getData();

		this.showPlayedOverlay(data);
		this.onCardConfirmed?.(data);

		if (data.id !== SKIP_CARD_ID) {
			const index = this.cards.indexOf(card);
			if (index !== -1) {
				card.view.removeFromParent();
				this.cards.splice(index, 1);
			}
		}

		this.exitSelectionMode();
	}

	/** Apply the highlighted visual to exactly the current caret index. */
	private applyHighlight(): void {
		this.cards.forEach((card, i) =>
			card.setHighlighted(i === this.highlightedIndex),
		);
		this.layoutCards();
	}

	/**
	 * Recompute every card's fan position, rotation, and pivot. Called
	 * whenever the card count, highlight, or screen size changes — this is
	 * the single source of truth for hand layout, replacing any per-card
	 * position logic that used to live in Card itself.
	 *
	 * The highlighted card doesn't lift straight up or straighten its
	 * rotation — it slides outward along the direction its own fan angle
	 * already points, using sin/cos of baseRotation as the direction
	 * vector, and keeps that same rotation the whole time. A card angled
	 * 15° to the side slides diagonally along that 15° and stays tilted;
	 * the center card (rotation 0) still moves straight up, which falls
	 * out of the same formula for free.
	 */
	private layoutCards(): void {
		const n = this.cards.length;
		if (n === 0) return;

		const center = (n - 1) / 2;

		this.cards.forEach((card, i) => {
			const offset = i - center;
			const isHighlighted = i === this.highlightedIndex && this.selecting;

			const baseRotation = offset * FAN_ROTATION_STEP;
			const baseX = offset * FAN_X_STEP;
			const baseY = Math.abs(offset) * FAN_Y_RISE;

			card.view.rotation = baseRotation;

			if (isHighlighted) {
				// Pull-out direction follows the card's OWN resting angle —
				// this is what makes an outer card slide diagonally instead
				// of popping straight up, with no rotation change at all.
				card.view.x = baseX + HIGHLIGHT_LIFT * Math.sin(baseRotation);
				card.view.y = baseY - HIGHLIGHT_LIFT * Math.cos(baseRotation);
			} else {
				card.view.x = baseX;
				card.view.y = baseY;
			}
		});

		if (this.selecting) this.positionCaret(0);
	}

	/** Build the small pulsing downward-pointing triangle caret. */
	private buildCaret(): void {
		const g = new Graphics();
		g.poly([0, 0, 16, 0, 8, 12]);
		g.fill(0xffd700);
		this.caret.addChild(g);
	}

	/**
	 * Move the caret above the currently highlighted card's actual position,
	 * accounting for its fan lift. `bob` is the pulse offset applied on top.
	 */
	private positionCaret(bob: number): void {
		if (this.highlightedIndex < 0 || this.highlightedIndex >= this.cards.length)
			return;
		const card = this.cards[this.highlightedIndex];
		this.caret.x = card.view.x - 8; // card.view.x is already horizontal center (bottom-center pivot)
		this.caret.y = card.view.y - CARD_HEIGHT - CARET_GAP + bob;
	}

	/** Show the brief "card played" detail overlay above the hand. */
	private showPlayedOverlay(data: CardData): void {
		this.overlayText.text = `${data.name}\n${data.description}`;
		this.overlayText.x = 0;
		this.overlayText.y = -CARD_HEIGHT - 70;
		this.overlayText.visible = true;

		const bounds = this.overlayText.getLocalBounds();
		this.overlayBg.clear();
		this.overlayBg.roundRect(
			this.overlayText.x - bounds.width / 2 - 10,
			this.overlayText.y - 6,
			bounds.width + 20,
			bounds.height + 12,
			6,
		);
		this.overlayBg.fill({ color: 0x000000, alpha: 0.75 });
		this.overlayBg.visible = true;

		this.overlayTimerMs = OVERLAY_DURATION_MS;
	}

	/** Data for the permanent "No Card" slot — always last, never spent. */
	private buildSkipCardData(): CardData {
		return {
			id: SKIP_CARD_ID,
			color: "none",
			name: "No Card",
			value: 0,
			description: "Move on base speed only — no card bonus",
			actionType: "move",
		};
	}

	/** Remove all current cards from view and state. */
	private clear(): void {
		this.cards.forEach((c) => c.view.removeFromParent());
		this.cards = [];
	}
}
