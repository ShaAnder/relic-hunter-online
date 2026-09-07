import type { GridCoord } from "../world/grid";

/** How many turns a last-known rival position stays worth chasing before being forgotten. Re-spotting the rival at any point resets this — it's both "how long a cold trail stays worth following" and "give up after this many consecutive turns without a sighting," since those are the same counter unless the rival is re-seen. */
export const AI_LOST_TRACK_TURNS = 4;

/** One rival's last known position and when it was actually seen there. */
export interface LastKnownRival {
	coord: GridCoord;
	seenTurn: number;
}

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
	/** Once true path toward exit until knockout / loss */
	extracting: boolean;
	/**
	 * Last known position of each rival this unit has actually seen,
	 * keyed by rival id. Updated only when a rival is genuinely
	 * visible right now (not merely "explored" fog) — lets aggressive
	 * and clever hunters keep chasing the direction a rival fled even
	 * after fog swallows them, rather than losing all memory of them
	 * the instant they step off a currently-visible tile.
	 */
	lastKnownRivals: Record<string, LastKnownRival>;
}

export function createAiMemory(): AiMemory {
	return {
		lastFleeDirection: null,
		consecutiveFleeTurns: 0,
		extracting: false,
		lastKnownRivals: {},
	};
}

/**
 * Call once per AI turn for every rival currently, actually visible
 * (not just explored) — records where they are right now as the
 * freshest lead. Call BEFORE deciding movement so a chase target
 * computed this same turn reflects the latest sighting.
 */
export function recordRivalSighting(
	memory: AiMemory,
	rivalId: string,
	coord: GridCoord,
	currentTurn: number,
): void {
	memory.lastKnownRivals[rivalId] = { coord, seenTurn: currentTurn };
}

/**
 * The freshest still-worth-chasing last-known rival position, or null
 * if every lead has gone cold (past AI_LOST_TRACK_TURNS) or none exist
 * at all. Ties broken by most-recently-seen.
 */
export function getFreshestLastKnownRival(
	memory: AiMemory,
	currentTurn: number,
): LastKnownRival | null {
	let best: LastKnownRival | null = null;
	for (const key in memory.lastKnownRivals) {
		const entry = memory.lastKnownRivals[key];
		if (currentTurn - entry.seenTurn > AI_LOST_TRACK_TURNS) continue;
		if (!best || entry.seenTurn > best.seenTurn) best = entry;
	}
	return best;
}

/** Drops leads that have gone fully cold — memory-cleanup only, getFreshestLastKnownRival already ignores them regardless. Call once per turn, not per frame. */
export function pruneColdRivalMemory(
	memory: AiMemory,
	currentTurn: number,
): void {
	for (const key in memory.lastKnownRivals) {
		if (
			currentTurn - memory.lastKnownRivals[key].seenTurn >
			AI_LOST_TRACK_TURNS
		) {
			delete memory.lastKnownRivals[key];
		}
	}
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

export function setExtracting(memory: AiMemory, value: boolean): void {
	memory.extracting = value;
}

/** Call whenever an entity does NOT flee this turn — fights, rests, holds — so a stale direction doesn't bias a future flee. */
export function clearFleeMemory(memory: AiMemory): void {
	memory.lastFleeDirection = null;
	memory.consecutiveFleeTurns = 0;
}
