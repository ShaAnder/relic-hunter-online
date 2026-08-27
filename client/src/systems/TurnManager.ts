import type {
	CardData,
	MercenaryState,
	EntityCore,
	HasHand,
	HasItems,
	HasTemporaryStatBonus,
	HasSpecial,
} from "@relic-hunter/shared";
import { drawCardsInto, applyRestHeal } from "@relic-hunter/shared";

export type TurnAction = "move" | "action" | "pass";

/** Hard gameplay invariant: a hunter can never hold more than five cards. */
export const MAX_HAND_SIZE = 5;

type ManagedEntity = EntityCore &
	HasHand &
	HasItems &
	HasTemporaryStatBonus &
	HasSpecial;

/**
 * Manages the AP-based turn cycle for a single match. Generic over any
 * entity with a hand and items.
 *
 * Turn lifecycle is explicit:
 *
 *   reset()     -> establish clean state, NEVER draw
 *   startTurn() -> refresh turn state and draw exactly one card, capped by hand
 *   endTurn()   -> finish the current turn, NEVER draw
 *
 * The returned CardData[] values are domain results only. MapScene may pass
 * them to CardDrawQueue for visual presentation; AI may insert them directly
 * into its hand.
 */
export class TurnManager<T extends ManagedEntity = MercenaryState> {
	private _apRemaining: number;
	private readonly _baseAp: number;
	private _hasMovedThisTurn = false;
	private _movementRemaining = 0;
	private _hasAttackedThisTurn = false;
	private _hasRestedThisTurn = false;
	private _hasUsedSpecialThisTurn = false;
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

	canSpecial(apCost: number): boolean {
		return !this._hasUsedSpecialThisTurn && this._apRemaining >= apCost;
	}

	get hasUsedSpecialThisTurn(): boolean {
		return this._hasUsedSpecialThisTurn;
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
			(!this.canMove &&
				!this.canAttack &&
				!this.canRest &&
				!this.canDisengage &&
				!this.canSpecial(1))
		);
	}

	get deckRemaining(): number {
		return this.getSharedDeck().length;
	}

	get handSize(): number {
		return this.getEntity().hand.length;
	}

	get maxHandSize(): number {
		return MAX_HAND_SIZE;
	}

	/** Number of cards this entity can still receive right now. */
	get handCapacity(): number {
		return Math.max(0, MAX_HAND_SIZE - this.handSize);
	}

	// ---------- MOVE ----------

	beginMovement(cardType: string, cardValue: number): boolean {
		if (!this.canMove) return false;
		this.clearSpecial();
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

	undoMovementForRetry(): void {
		this._apRemaining += 1;
		this._hasMovedThisTurn = false;
		this._movementRemaining = 0;
		this.onChanged();
	}

	// ---------- ACTIONS ----------

	spendAttack(): boolean {
		if (!this.canAttack) return false;
		this.clearSpecial();
		this._apRemaining -= 2;
		this._hasAttackedThisTurn = true;
		this.onChanged();
		return true;
	}

	/** Spend 1 AP on Rest and draw up to 2 cards, capped by hand capacity. */
	spendRest(): CardData[] | null {
		if (!this.canRest) return null;
		this.clearSpecial();
		this._apRemaining -= 1;
		this._hasRestedThisTurn = true;
		const drawn = this.pullFromDeck(Math.min(2, this.handCapacity));
		applyRestHeal(this.getEntity());
		this.onChanged();
		return drawn;
	}

	/** Spend 2 AP to Disengage — alternative movement, immune to ZoC. */
	beginDisengage(): boolean {
		if (!this.canDisengage) return false;
		this.clearSpecial();
		this._apRemaining -= 2;
		this.onChanged();
		return true;
	}

	useSpecial(apCost: number, specialId: string): boolean {
		if (!this.canSpecial(apCost)) return false;
		this._apRemaining -= apCost;
		this._hasUsedSpecialThisTurn = true;
		this.getEntity().special = specialId;
		this.onChanged();
		return true;
	}

	clearSpecial(): void {
		const entity = this.getEntity();
		if (entity.special !== null) entity.special = null;
	}

	// ---------- TURN LIFECYCLE ----------

	/**
	 * Start a turn and return the cards that should be presented.
	 *
	 * Normal turns draw exactly one card, but never beyond the five-card hand
	 * limit. The returned card is NOT inserted into entity.hand here; this keeps
	 * visual local-player draws and silent AI draws on the same domain result.
	 */
	startTurn(): CardData[] {
		this.refreshTurnState();
		const drawn = this.pullFromDeck(Math.min(1, this.handCapacity));
		this.onChanged();
		return drawn;
	}

	/**
	 * End the current turn. Ending a turn does not draw or refresh anything.
	 * The next participant calls startTurn() when their turn actually begins.
	 */
	endTurn(): void {
		this.onChanged();
	}

	/** Construction/reset path. Never draws a card. */
	reset(): void {
		this.refreshTurnState();
		this.onChanged();
	}

	/** Initial game setup: fill the hand to five cards, not a turn draw. */
	dealStartingHand(): CardData[] {
		return this.pullFromDeck(this.handCapacity > 0 ? this.handCapacity : 0);
	}

	/** Silent draw straight into the entity hand, capped at five. */
	drawCardsIntoHand(count: number): void {
		const allowed = Math.min(Math.max(0, count), this.handCapacity);
		drawCardsInto(this.getEntity().hand, this.getSharedDeck(), allowed);
	}

	/** Reset AP/flags without drawing a card for special recovery/stun flows. */
	refreshTurnWithoutDraw(): void {
		this.refreshTurnState();
		this.onChanged();
	}

	private refreshTurnState(): void {
		this._apRemaining = this._baseAp;
		this._hasMovedThisTurn = false;
		this._movementRemaining = 0;
		this._hasAttackedThisTurn = false;
		this._hasRestedThisTurn = false;
		this._hasUsedSpecialThisTurn = false;
		this.getEntity().temporaryStatBonus = {
			attack: 0,
			defense: 0,
			movement: 0,
		};
	}

	/** Pull from the shared deck into a buffer; does not touch entity.hand. */
	private pullFromDeck(count: number): CardData[] {
		const buffer: CardData[] = [];
		const safeCount = Math.min(Math.max(0, count), this.handCapacity);
		if (safeCount > 0) {
			drawCardsInto(buffer, this.getSharedDeck(), safeCount);
		}
		return buffer;
	}
}
