import { isAdjacent } from "../world/grid";
import type { MonsterState } from "../types/monster";
import type { EntityCore } from "../types/entity";

/** A hunter as monster targeting logic sees it — core plus the one field this specific decision context needs (carrier status). */
export type MonsterTargetCandidate = EntityCore & { isCarryingTarget: boolean };

/**
 * Which hunter a monster targets this turn. Already-adjacent hunters take
 * priority over chasing anyone else
 *
 * Otherwise the target relic carrier is chased, specifically if one exists;
 * If not falls back to whichever hunter is closest.
 */
export function decideMonsterTarget(
	self: MonsterState,
	hunters: MonsterTargetCandidate[],
): MonsterTargetCandidate | null {
	if (hunters.length === 0) return null;

	const adjacent = hunters.find((h) => isAdjacent(self.coord, h.coord));
	if (adjacent) return adjacent;

	const carrier = hunters.find((h) => h.isCarryingTarget);
	if (carrier) return carrier;

	return hunters.reduce((closest, h) => {
		const d1 =
			Math.abs(h.coord.x - self.coord.x) + Math.abs(h.coord.y - self.coord.y);
		const d2 =
			Math.abs(closest.coord.x - self.coord.x) +
			Math.abs(closest.coord.y - self.coord.y);
		return d1 < d2 ? h : closest;
	});
}
