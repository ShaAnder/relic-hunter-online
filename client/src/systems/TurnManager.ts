import type {
	CardData,
	MercenaryState,
	EntityCore,
	HasHand,
	HasItems,
} from "@relic-hunter/shared";
import { drawCardsInto, applyRestHeal } from "@relic-hunter/shared";

export type TurnAction = "move" | "action" | "pass";

/** Starting hand size — tops up toward MAX_HAND_SIZE via subsequent draws. */
const STARTING_HAND_SIZE = 4;

/**
 * Anything TurnManager can be attached to — genuinely needs a hand (to draw/spend cards)
 * and items (Rest heals toward hpCeiling). Not every entity has both — monsters deliberately don't,
 * and never get a TurnManager.
 */
type ManagedEntity = EntityCore & HasHand & HasItems;

/**
 * Manages the AP-based turn cycle for a single match. Generic over any
 * entity with a hand and items
 *
 * Each turn the entity has a base AP pool spent across Move and
 * Action (Attack / Rest / Disengage), in any order.
 *
 * Also owns the draw side of the hand economy: 1 card at the start of
 * every turn, and up to 2 more from Rest. Both draw from the ONE shared
 * match deck (`getSharedDeck`, backed by `GameSession.sharedDeck`).
 */
export class TurnManager<T extends ManagedEntity = MercenaryState> {
	private _apRemaining: number;
	private readonly _baseAp: number;

	private _hasMovedThisTurn = false;
	private _movementRemaining = 0;

	private _hasAttackedThisTurn = false;
	private _hasRestedThisTurn = false;

	private onChanged: () => void;

	constructor(
		private getEntity: () => T,
		private getSharedDeck: () => CardData[],
		onChanged: () => void,
		baseAp?: number,
	) {
		this.onChanged = onChanged;
		this._baseAp = baseAp ?? this.getEntity().stats.ap;
		this._apRemaining = this._baseAp;
		this.reset();
	}

	// ---------- GETTERS ----------

	get apRemaining(): number {
		return this._apRemaining;
	}

	get baseAP(): number {
		return this._baseAp;
	}

	/** Move is available once per turn, regardless of what else has been spent, as long as 1 AP remains. */
	get canMove(): boolean {
		return !this._hasMovedThisTurn && this._apRemaining >= 1;
	}

	get canAttack(): boolean {
		return !this._hasAttackedThisTurn && this._apRemaining >= 2;
	}

	get canRest(): boolean {
		return !this._hasRestedThisTurn && this._apRemaining >= 1;
	}

	get canDisengage(): boolean {
		return this._apRemaining >= 2;
	}

	get hasMovedThisTurn(): boolean {
		return this._hasMovedThisTurn;
	}

	get movementRemaining(): number {
		return this._movementRemaining;
	}

	get hasAttackedThisTurn(): boolean {
		return this._hasAttackedThisTurn;
	}

	get hasRestedThisTurn(): boolean {
		return this._hasRestedThisTurn;
	}

	get isTurnComplete(): boolean {
		return (
			this.apRemaining <= 0 ||
			(!this.canMove && !this.canAttack && !this.canRest && !this.canDisengage)
		);
	}

	get deckRemaining(): number {
		return this.getSharedDeck().length;
	}

	get handSize(): number {
		return this.getEntity().hand.length;
	}

	// ---------- MOVE ----------

	/**
	 * Begin the turn's single Move. A blue card may be played on it
	 * unconditionally now — there's no "first press" concept left to
	 * gate it.
	 */
	beginMovement(cardType: string, cardValue: number): boolean {
		if (!this.canMove) return false;

		let budget = this.getEntity().stats.movement;
		if (cardType === "blue") {
			budget += cardValue;
		}
		this._movementRemaining = budget;

		this._apRemaining -= 1;
		this._hasMovedThisTurn = true;

		this.onChanged();
		return true;
	}

	commitMove(tilesSpent: number): void {
		this._movementRemaining = Math.max(0, this.movementRemaining - tilesSpent);
		this.onChanged();
	}

	// ---------- ACTIONS ----------

	/** Spend 2 AP on Attack. No longer touches Move at all. */
	spendAttack(): boolean {
		if (!this.canAttack) return false;
		this._apRemaining -= 2;
		this._hasAttackedThisTurn = true;
		this.onChanged();
		return true;
	}

	/** Spend 1 AP on Rest, heal toward the current HP ceiling,
	 * draw up to 2 cards. No longer touches Move at all. */
	spendRest(): boolean {
		if (!this.canRest) return false;
		this._apRemaining -= 1;
		this._hasRestedThisTurn = true;
		this.drawCards(2);
		applyRestHeal(this.getEntity());
		this.onChanged();
		return true;
	}

	/** Spend 2 AP to Disengage — a full alternative movement, ZoC-immune. */
	beginDisengage(): boolean {
		if (!this.canDisengage) return false;
		this._apRemaining -= 2;
		this.onChanged();
		return true;
	}

	// ---------- TURN LIFECYCLE ----------

	endTurn(): void {
		this._apRemaining = this._baseAp;
		this._hasMovedThisTurn = false;
		this._movementRemaining = 0;
		this._hasAttackedThisTurn = false;
		this._hasRestedThisTurn = false;
		this.drawCards(1);
		this.onChanged();
	}

	reset(): void {
		this.endTurn();
	}

	dealStartingHand(): void {
		const entity = this.getEntity();
		const needed = STARTING_HAND_SIZE - entity.hand.length;
		if (needed > 0) this.drawCards(needed);
	}

	private drawCards(count: number): void {
		drawCardsInto(this.getEntity().hand, this.getSharedDeck(), count);
	}
}
