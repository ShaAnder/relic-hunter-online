import type { GridCoord } from "../world/grid";
import type { MercenaryStats } from "../types/mercenary";
import type { CardData } from "../cards/card";
import { rollDie } from "../math/dice";

export type TrapKind = "stun";

/**
 * A trap placed on the grid, tied to whoever placed it.
 * Position is fixed once placed — traps don't move.
 */
export interface Trap {
	id: string;
	coord: GridCoord;
	ownerId: string;
	kind: TrapKind;
}

/**
 * How far a Hunter-classed unit can detect any environmental tile,
 * regardless of who placed it. Everyone else only ever sees their own. */
export const HUNTER_TRAP_SIGHT_RANGE = 4;

/**
 * Whether a specific viewer can currently see this trap. Always true for
 * whoever placed it — never true for anyone else, UNLESS the viewer is
 * specifically Hunter-classed and within detection range
 */
export function canSeeTrap(
	trap: Trap,
	viewerId: string,
	viewerCoord: GridCoord,
	viewerIsHunterClass: boolean,
): boolean {
	if (trap.ownerId === viewerId) return true;
	if (!viewerIsHunterClass) return false;
	const distance =
		Math.abs(trap.coord.x - viewerCoord.x) +
		Math.abs(trap.coord.y - viewerCoord.y);
	return distance <= HUNTER_TRAP_SIGHT_RANGE;
}

export interface HazardRollResult {
	landed: boolean;
	hazardRoll: number;
	victimRoll: number;
}

const HAZARD_DIE_SIDES = 10;

/**
 * Hazard-specific rules for what a roll means — traps now, other
 * environmental effects later. Rolls through rollDie rather than
 * inlining its own randomness, so hazards and the future core combat
 * dice system always share the same underlying die
 */
export function resolveHazardRoll(
	victimStats: MercenaryStats,
	victimCard?: CardData,
): HazardRollResult {
	const hazardRoll = rollDie(HAZARD_DIE_SIDES);

	if (victimCard?.value === "A") {
		return { landed: false, hazardRoll, victimRoll: Infinity };
	}

	let ceiling = victimStats.defense;
	if (victimCard?.value === "C") {
		ceiling = Math.round(victimStats.defense * 1.5);
	} else if (typeof victimCard?.value === "number") {
		ceiling = victimStats.defense + victimCard.value;
	}

	const victimRoll = rollDie(ceiling);
	return { landed: hazardRoll > victimRoll, hazardRoll, victimRoll };
}
