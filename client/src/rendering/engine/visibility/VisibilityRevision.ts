/**
 * Monotonic revision for event-driven visibility state.
 *
 * assigns events (see visibilityevents) a version number, when something happens
 * then is called when those two versions need to be checked. We use this as
 * a version tracker effectively.
 *
 * Something else will check and see if the versions differ then recompute if needed.
 */
export class VisibilityRevision {
	private value = 0;

	current(): number {
		return this.value;
	}

	bump(): number {
		this.value += 1;
		return this.value;
	}

	reset(): void {
		this.value = 0;
	}
}
