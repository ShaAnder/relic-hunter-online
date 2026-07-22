import type { CardData, MercenaryState } from "@relic-hunter/shared";

export type TurnAction = "move" | "action" | "pass";

/** Max cards a mercenary can hold. Draws (turn-start or Rest) never exceed this. */
const STARTING_HAND_SIZE = 4;
const MAX_HAND_SIZE = 5;

/**
 * Manages the AP-based turn cycle for a single match.
 *
 * Each turn the player has a base pool of AP (from the mercenary's `ap`
 * stat) to spend across Move and Action (Attack / Rest / Disengage).
 * Spending Attack or Rest permanently locks Move for the rest of the turn.
 * The Move button may be pressed up to twice per turn while unlocked, each
 * press costing 1 AP — a blue Move card may only be played on the first
 * press; the movement pool is shared and carries over into the second.
 *
 * Also owns the draw side of the hand economy: 1 card at the start of
 * every turn (including the first — the constructor resets straight into
 * a turn), and up to 2 more from Rest. Both draw from the ONE shared match
 * deck (`getSharedDeck`, backed by `GameSession.sharedDeck`) — there is no
 * personal per-mercenary deck. Draws mutate both the shared deck array and
 * this mercenary's `hand` in place; since both are plain array/object
 * references, that mutation is visible to anything else holding the same
 * references (MapScene, the deck-tracker UI, etc.) with no extra plumbing.
 * No reshuffle on exhaustion — see `04-card-system-design.md` §Hand
 * Economy for what an empty shared deck triggers.
 */
export class TurnManager {
	// ap pool
	private _apRemaining: number;
	private readonly _baseAp: number;

	// Movement tracking
	private _movementPressesUsed = 0;
	private _moveLocked = false;

	// remaining movement, player can use movement card on first move only
	private _movementRemaining = 0;
	private _blueCardUsedThisTurn = false;

	// action tracking - have they attacked or rested
	private _hasAttackedThisTurn = false;
	private _hasRestedThisTurn = false;

	// private onChanged func to fire when state changes for ui refresh
	private onChanged: () => void;

	constructor(
		private getMercState: () => MercenaryState,
		/** Accessor for the ONE shared match deck — not per-mercenary. */
		private getSharedDeck: () => CardData[],
		onChanged: () => void,
		baseAp?: number,
	) {
		this.onChanged = onChanged;
		this._baseAp = baseAp ?? this.getMercState().stats.ap;
		this._apRemaining = this._baseAp;
		this.reset();
	}

	// ---------- GETTERS ----------

	/* Remaining AP this turn */
	get apRemaining(): number {
		return this._apRemaining;
	}

	/* Base AP for the character */
	get baseAP(): number {
		return this._baseAp;
	}

	/**
	 * Is Move button available Y/N.
	 * The first press is always allowed if AP/lock permit it — the pool
	 * hasn't been set yet, so there's nothing to check. Any press after
	 * the first additionally requires actual movement left in the pool,
	 * otherwise pressing Move again would spend an AP for nothing.
	 */
	get canMove(): boolean {
		const hasBudgetForAnotherPress =
			this._movementPressesUsed === 0 || this._movementRemaining > 0;

		return (
			!this._moveLocked &&
			this._movementPressesUsed < 2 &&
			this._apRemaining >= 1 &&
			hasBudgetForAnotherPress
		);
	}

	/* Is attack action available Y/N */
	get canAttack(): boolean {
		return !this._hasAttackedThisTurn && this._apRemaining >= 2;
	}

	/* Is rest action available Y/N */
	get canRest(): boolean {
		return !this._hasRestedThisTurn && this._apRemaining >= 1;
	}

	/* Is disengage available Y/N */
	get canDisengage(): boolean {
		return this._apRemaining >= 1;
	}

	/* Whether move button is perma locked */
	get moveLocked(): boolean {
		return this._moveLocked;
	}

	/* Number of movement tiles remaining */
	get movementRemaining(): number {
		return this._movementRemaining;
	}

	/* how many times move has been pressed */
	get movePressesUsed(): number {
		return this._movementPressesUsed;
	}

	/* Whether a blue Move card has already been played this turn */
	get blueCardUsedThisTurn(): boolean {
		return this._blueCardUsedThisTurn;
	}

	/* Whether attack has been presed */
	get hasAttackedThisTurn(): boolean {
		return this._hasAttackedThisTurn;
	}

	/* Wheter rest has been pressed */
	get hasRestedThisTurn(): boolean {
		return this._hasRestedThisTurn;
	}

	/* Is turn complete */
	get isTurnComplete(): boolean {
		return (
			this.apRemaining <= 0 ||
			(this.moveLocked &&
				!this.canAttack &&
				!this.canRest &&
				!this.canDisengage)
		);
	}

	/** Cards remaining in the ONE shared match deck — for the deck-tracker UI. */
	get deckRemaining(): number {
		return this.getSharedDeck().length;
	}

	/** Cards currently in this mercenary's hand — for the deck-tracker UI. */
	get handSize(): number {
		return this.getMercState().hand.length;
	}

	// ---------- MOVE ----------

	/**
	 * Begin user movement phase and does nessecary deductions / additions
	 * Call before entering MoveController aim mode.
	 * Returns false if Move is not currently available.
	 *
	 * @param cardType - type of the card we wish to use
	 * @param cardValue - value of the card (only useful for movement if blue)
	 * @returns - boolean
	 */
	beginMovement(cardType: string, cardValue: number): boolean {
		if (!this.canMove) return false;

		// First move press of the turn — allow blue card once
		if (this._movementPressesUsed === 0) {
			// Movement budget is the mercenary's movement stat, NOT the AP pool.
			let budget = this.getMercState().stats.movement;

			if (cardType === "blue" && !this._blueCardUsedThisTurn) {
				budget += cardValue;
				this._blueCardUsedThisTurn = true;
			}

			this._movementRemaining = budget;
		}
		// Subsequent moves reuse remaining pool

		this._apRemaining -= 1;
		this._movementPressesUsed += 1;

		this.onChanged();
		return true;
	}

	/**
	 * Commit the move: update the logical position and zero the movement
	 * budget. The card value was already applied in beginMove().
	 */
	commitMove(tilesSpent: number): void {
		// clamp against budget incase of float or path mismatch
		this._movementRemaining = Math.max(0, this.movementRemaining - tilesSpent);
		this.onChanged();
	}

	// ---------- ACTIONS ----------

	/**
	 * Spend 2 ap on an attack and lock move for the rest of the turn
	 */
	spendAttack(): boolean {
		if (!this.canAttack) return false;

		this._apRemaining -= 2;
		this._hasAttackedThisTurn = true;
		this._moveLocked = true;
		this._movementRemaining = 0;
		this.onChanged();
		return true;
	}

	/**
	 * Spend 1 ap on rest, lock move for the rest of the turn, and draw up
	 * to 2 cards from the shared deck (capped by hand max and by however
	 * many cards remain in the deck). Once per turn, per canRest.
	 */
	spendRest(): boolean {
		if (!this.canRest) return false;

		this._apRemaining -= 1;
		this._hasRestedThisTurn = true;
		this._moveLocked = true;
		this._movementRemaining = 0;
		this.drawCards(2);
		this.onChanged();
		return true;
	}

	/**
	 * Spend 1 ap to disengage, does not lock movement for rest of the tern
	 */
	spendDisengage(): boolean {
		if (!this.canDisengage) return false;

		this._apRemaining -= 1;
		this.onChanged();
		return true;
	}

	// ---------- TURN LIFECYCLE ----------

	/**
	 * End current turn and reset all AP / action state, then draw 1 card
	 * from the shared deck for the turn that's about to begin. Also runs
	 * via reset() at match start, so the very first turn draws too — hand
	 * starts empty (createMercenary), not pre-dealt.
	 */
	endTurn(): void {
		this._apRemaining = this._baseAp;
		this._movementPressesUsed = 0;
		this._moveLocked = false;
		this._hasAttackedThisTurn = false;
		this._hasRestedThisTurn = false;
		// Reset to 0, not baseAP — the real budget is set by beginMovement()
		// on the turn's first press, from the mercenary's speed stat.
		this._movementRemaining = 0;
		this._blueCardUsedThisTurn = false;
		this.drawCards(1);
		this.onChanged();
	}

	// Full reset function to wipe on match start / regen
	reset(): void {
		this.endTurn();
	}

	/**
	 * Deal the mercenary's starting hand up to MAX_HAND_SIZE (5). Call once,
	 * right after constructing TurnManager, before any real turn begins.
	 *
	 * This is separate from the normal per-turn draw-1 — the constructor
	 * already drew 1 card via reset()→endTurn(). drawCards() is
	 * self-limiting based on current hand size (roomInHand), so calling
	 * drawCards(MAX_HAND_SIZE) here correctly tops up to exactly 5
	 * regardless of that already-drawn card — it just draws the remaining
	 * 4, not 5 more.
	 */
	dealStartingHand(): void {
		this.drawCards(STARTING_HAND_SIZE);
	}

	/**
	 * Draw up to `count` cards from the shared deck into this mercenary's
	 * hand, capped by MAX_HAND_SIZE and by whatever's actually left in the
	 * deck. No reshuffle when the deck runs dry — draws just stop.
	 */
	private drawCards(count: number): void {
		const merc = this.getMercState();
		const sharedDeck = this.getSharedDeck();
		const roomInHand = MAX_HAND_SIZE - merc.hand.length;
		const actualDraw = Math.min(count, roomInHand, sharedDeck.length);

		// .shift() is O(n) (removes from the front, re-indexes the rest) —
		// fine at this deck size (75 cards); would be worth a head-pointer/
		// queue if deck sizes ever grew by orders of magnitude.
		for (let i = 0; i < actualDraw; i++) {
			const card = sharedDeck.shift();
			if (card) merc.hand.push(card);
		}
	}
}
