import { Container, Graphics, Text } from "pixi.js";
import type { CardData } from "@relic-hunter/shared";
import { Card, CARD_WIDTH, CARD_HEIGHT } from "@/entities/Card";

const CARET_PULSE_SPEED = 0.006; // radians per ms — tuned for a gentle bob
const CARET_PULSE_RANGE = 6; // pixels
const OVERLAY_DURATION_MS = 1500;

// Fan layout tuning — a wider spread or step reads as more "spread open"
const FAN_ROTATION_STEP = 0.09; // radians per card offset from center (~5°)
const FAN_X_STEP = 55; // horizontal spacing — tighter than CARD_WIDTH so cards overlap
const FAN_Y_RISE = 8; // px each card drops per offset unit from center
const HIGHLIGHT_LIFT = 34; // px the selected card slides outward along its fan angle
const CARET_GAP = 18; // px between a card's top edge and the caret

// Hide/reveal tuning — see class docblock for the container split this drives
const REVEALED_Y_OFFSET = -40; // matches the hand's old fixed resting position
const HIDDEN_Y_OFFSET = CARD_HEIGHT - 25; // ~85px down; leaves a ~25px peek above the screen edge
const HOVER_EASE_MS = 180; // how quickly the fan responds to a hover state change

/** Reserved id for the permanent "No Card" option — never removed on play, never part of mercState.hand. */
export const SKIP_CARD_ID = "__skip__";

/**
 * Renders the player's hand as a fanned arc (rotation + arc offset per
 * card, pivoting from the bottom-center of each card) and owns
 * card-selection during the Move action.
 */
export class Hand {
	readonly view = new Container();
	private fanContainer = new Container();

	private cards: Card[] = [];
	private onCardConfirmed?: (card: CardData) => void;

	// Selection state
	private selecting = false;
	private highlightedIndex = -1;
	private selectableFilter: (data: CardData) => boolean = () => true;

	// Hover/reveal state
	private isHovered = false;
	private forceRevealed = false;

	// Caret indicator
	private caret = new Container();
	private caretElapsedMs = 0;

	// Transient "card played" detail overlay
	private overlayBg = new Graphics();
	private overlayText: Text;
	private overlayTimerMs = 0;

	constructor(onCardConfirmed?: (card: CardData) => void) {
		this.onCardConfirmed = onCardConfirmed;

		this.view.addChild(this.fanContainer);
		this.fanContainer.y = HIDDEN_Y_OFFSET;

		this.buildCaret();
		this.caret.visible = false;
		this.fanContainer.addChild(this.caret);

		this.overlayText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 13, align: "center" },
		});
		this.overlayText.anchor.set(0.5, 0);
		this.fanContainer.addChild(this.overlayBg);
		this.fanContainer.addChild(this.overlayText);
		this.overlayBg.visible = false;
		this.overlayText.visible = false;
	}

	/** Whether card selection is currently active (a Move is in progress). */
	get isSelecting(): boolean {
		return this.selecting;
	}

	/**
	 * Tell the fan whether the mouse is currently over its reveal zone.
	 * MapScene calls this from its own mousemove handler based on raw
	 * screen-Y position — deliberately not driven by Pixi pointerover/out
	 * on a dedicated hit zone, since an interactive card sitting on top of
	 * such a zone would steal those events and cause the fan to flicker
	 * hidden while the player is still trying to use it.
	 */
	setHovered(isHovered: boolean): void {
		this.isHovered = isHovered;
	}

	/**
	 * Rebuild the displayed cards to match the mercenary's actual hand,
	 * plus the permanent skip slot appended at the end. This is the only
	 * way cards get onto the fan — there is no local test/starter hand.
	 *
	 * Full teardown-and-rebuild rather than diffing against the previous
	 * cards — simpler and correct. Hand changes are infrequent (once or
	 * twice a turn), not a hot per-frame path, so the rebuild cost is
	 * irrelevant.
	 */
	syncFromHand(hand: CardData[]): void {
		this.clear();

		const displayCards = [...hand, this.buildSkipCardData()];

		displayCards.forEach((data) => {
			const card = new Card(data);
			// Resting state: full color, just not clickable until Move is pressed
			card.setInteractive(false);
			card.setGreyedOut(false);
			// Bottom-center pivot so rotation reads as fanning from a grip
			// point below the hand, not spinning around each card's corner
			card.view.pivot.set(CARD_WIDTH / 2, CARD_HEIGHT);
			this.cards.push(card);
			this.fanContainer.addChild(card.view);

			// Bound to the Card object, not a captured index — see file JSDoc
			card.view.on("pointerover", () => this.handlePointerOverCard(card));
			card.view.on("pointerdown", () => this.handlePointerDownCard(card));
		});

		this.layoutCards();
	}

	/**
	 * Begin card selection: grey out cards that fail the filter, highlight
	 * the first selectable card, show the caret, and force the fan
	 * revealed regardless of hover state. Call when Move is pressed.
	 */
	enterSelectionMode(filter: (data: CardData) => boolean): void {
		this.selectableFilter = filter;
		this.selecting = true;
		this.forceRevealed = true;

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

	/**
	 * Exit selection mode: hide the caret, return every card to full-color
	 * rest, and let the fan go back to hover-driven hide/reveal.
	 */
	exitSelectionMode(): void {
		this.selecting = false;
		this.forceRevealed = false;
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

	/**
	 * Per-frame tick: eases the fan toward its hidden/revealed target,
	 * pulses the caret, and counts down the played-card overlay.
	 */
	update(deltaTime: number): void {
		const deltaMs = (deltaTime / 60) * 1000;

		// Ease-toward-target: moves a fraction of the remaining distance
		// each frame rather than a fixed-duration tween. Simple, framerate-
		// tolerant enough for a UI polish detail, no separate timer state
		// needed the way Camera.panTo's cinematic pan requires.
		const targetY =
			this.isHovered || this.forceRevealed
				? REVEALED_Y_OFFSET
				: HIDDEN_Y_OFFSET;
		const easeT = Math.min(1, deltaMs / HOVER_EASE_MS);
		this.fanContainer.y += (targetY - this.fanContainer.y) * easeT;

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

	/** Anchor the hand at the fixed bottom-center of the screen. Never animated directly. */
	resize(width: number, height: number): void {
		this.view.x = width / 2;
		this.view.y = height;
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
	 * Play the given card: show the brief detail overlay, fire the effect
	 * callback, and exit selection mode. Does NOT remove the card from
	 * `this.cards` directly — the caller (MapScene) removes it from the
	 * real mercState.hand as the first thing it does with the callback,
	 * which triggers a syncFromHand() rebuild through the normal
	 * onChanged → syncUI cascade. That rebuild is what actually makes the
	 * played card disappear from the fan.
	 */
	private playCard(card: Card): void {
		const data = card.getData();
		this.showPlayedOverlay(data);
		this.onCardConfirmed?.(data);
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
	 * Recompute every card's fan position, rotation, and pivot — all
	 * relative to fanContainer's own origin, unaffected by whatever the
	 * hide/reveal animation is doing to fanContainer.y itself.
	 *
	 * The highlighted card doesn't lift straight up or straighten its
	 * rotation — it slides outward along the direction its own fan angle
	 * already points, using sin/cos of baseRotation as the direction
	 * vector, and keeps that same rotation the whole time.
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

	/** Data for the permanent "No Card" slot — always last, never spent, never real hand data. */
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
