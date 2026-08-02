import type { GridCoord } from "../world/grid";

/**
 * Persistent per-entity AI memory — survives across turns, unlike the
 * momentary AiCombatant snapshot rebuilt fresh each decision call. Lives
 * alongside MercenaryState on whatever owns the entity
 */
export interface AiMemory {
	/**
	 * Direction of the last voluntary retreat. Biases future retreat
	 * decisions toward continuing the same way instead of re-deriving
	 * "away from the threat" from scratch every turn
	 */
	lastFleeDirection: GridCoord | null;
	/** Consecutive turns spent fleeing without disengaging.  */
	consecutiveFleeTurns: number;
}

export function createAiMemory(): AiMemory {
	return { lastFleeDirection: null, consecutiveFleeTurns: 0 };
}

/** Call once an entity has committed to a flee move this turn. */
export function recordFlee(
	memory: AiMemory,
	from: GridCoord,
	to: GridCoord,
): void {
	memory.lastFleeDirection = { x: to.x - from.x, y: to.y - from.y };
	memory.consecutiveFleeTurns += 1;
}

/** Call whenever an entity does NOT flee this turn — fights, rests, holds — so a stale direction doesn't bias a future flee. */
export function clearFleeMemory(memory: AiMemory): void {
	memory.lastFleeDirection = null;
	memory.consecutiveFleeTurns = 0;
}
