import type { MercenaryState } from "@relic-hunter/shared";

export type TurnAction = "move" | "action" | "pass";

/**
 * Manages the AP-based turn cycle for a single match.
 *
 * Each turn the player has a base pool of 3 AP to spend across Move and
 * Action (Attack / Rest / Disengage). Spending any Action permanently locks
 * the Move button for the rest of the turn. The Move button may be pressed
 * up to twice per turn while unlocked, each press costing 1 AP.
 *
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

	/* Is Move button available Y/N */
	get canMove(): boolean {
		return (
			!this._moveLocked &&
			this._movementPressesUsed < 2 &&
			this._apRemaining >= 1
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
		let movementRemaining = this.baseAP;
		if (cardType === "blue") {
			if (this._blueCardUsedThisTurn) return false;
			movementRemaining += cardValue;
			this._blueCardUsedThisTurn = true;
		}

		this._apRemaining -= 1;
		this._movementPressesUsed += 1;
		this._movementRemaining = movementRemaining; // for now it will be card value but for later should be base speed + cv
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
	 * Spend 1 ap on rest and lock move for the rest of the turn
	 */
	spendRest(): boolean {
		if (!this.canRest) return false;

		this._apRemaining -= 1;
		this._hasRestedThisTurn = true;
		this._moveLocked = true;
		this._movementRemaining = 0;
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
	 * End current turn and reset all AP / action state
	 */
	endTurn(): void {
		this._apRemaining = this._baseAp;
		this._movementPressesUsed = 0;
		this._moveLocked = false;
		this._hasAttackedThisTurn = false;
		this._hasRestedThisTurn = false;
		this._movementRemaining = this.baseAP;
		this._blueCardUsedThisTurn = false;
		this.onChanged();
	}

	// Full reset function to wipe on match start / regen
	reset(): void {
		this.endTurn();
	}
}
