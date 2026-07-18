import type { MercenaryState } from "@relic-hunter/shared";

/**
 * Manages the turn cycle for a single match.
 *
 * Right now that means one Move action per turn, tracked with a flag and a
 * movement budget. This class is the designated growth point for proper turn
 * phases (roll → move → act → end) once dice and cards land — nothing else
 * in the codebase needs to change when that happens.
 *
 * Client-only for Phase 1; in Phase 3 the server owns turns and this
 * becomes a read-only mirror of server state.
 */
export class TurnManager {
	private _hasMovedThisTurn = false;
	private _movementRemaining = 0;

	// Callback so the scene can refresh its stats overlay when turn state changes
	private onChanged: () => void;

	constructor(
		private getMercState: () => MercenaryState,
		onChanged: () => void,
	) {
		this.onChanged = onChanged;
		this.reset();
	}

	/** Whether the player is still allowed to Move this turn. */
	get canMove(): boolean {
		return !this._hasMovedThisTurn;
	}

	/** Remaining movement budget for this turn. */
	get movementRemaining(): number {
		return this._movementRemaining;
	}

	/** Whether the turn's Move action has been used. */
	get hasMovedThisTurn(): boolean {
		return this._hasMovedThisTurn;
	}

	/**
	 * Spend the turn's Move action and zero the budget.
	 * Called by the scene once a move is committed.
	 */
	spendMove(): void {
		this._hasMovedThisTurn = true;
		this._movementRemaining = 0;
		this.onChanged();
	}

	/**
	 * End the current turn and restore the movement budget.
	 * No-ops mid-animation — the caller is responsible for checking
	 * mercenary.isAnimating before calling this.
	 */
	endTurn(): void {
		this._hasMovedThisTurn = false;
		this._movementRemaining = this.getMercState().stats.speed;
		this.onChanged();
	}

	/** Reset to a fresh turn — called when a new match starts or [R] regenerates. */
	reset(): void {
		this._hasMovedThisTurn = false;
		this._movementRemaining = this.getMercState().stats.speed;
		this.onChanged();
	}
}
