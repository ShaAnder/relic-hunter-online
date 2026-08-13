import type { Grid, GridCoord } from "../world/grid";
import { coordKey } from "../world/grid";
import type { MovementRangeEntry } from "../world/movement";
import type { ZoneOwner } from "../combat/zoneOfControl";
import { zoneReaches, findZonesCrossed } from "../combat/zoneOfControl";
import type { MercenaryStats } from "../types/mercenary";
import { resolveReactionStrike } from "../combat/combat";
import type { AiArchetype } from "./mercenaryAI";

/**
 * A zone owner that also carries enough to estimate real reaction-strike damage
 * against a specific mover, not just detect whether their zone reaches a tile.
 *
 * This is basically the controller of the ZOC we use their stats to weigh if the threat
 * threshold is too high for a unit to cross
 */
export interface ThreatOwner extends ZoneOwner {
	stats: MercenaryStats;
}

/**
 * How much extra movement-eq cost one point of expected reaction strike dmg is worth
 * per archetype. Think "is it worth it", aggressive hunters will happily cut through
 * zones to fight as they see it as very worth it due to low cost, however treasure hunters
 * inflate the cost heavily, weighing zoc cut throughs as not worth it.
 */
export const ARCHETYPE_ZOC_COST_MULTIPLIER: Record<AiArchetype, number> = {
	aggressive: 5,
	balanced: 10,
	treasure: 20,
};

/**
 * Hard Refuse line, if chosen paths total expected damage would exceed this fraction
 * of the movers CURRENT HP. Hard no. Refused outright no matter the pathing score
 */
export const ARCHETYPE_ZOC_REFUSAL_THRESHOLD: Record<AiArchetype, number> = {
	aggressive: 0.6,
	balanced: 0.4,
	treasure: 0.25,
};

/**
 * Fraction of the mover's max HP that entering this one tile would cost,
 * summed across every zone that actually reaches it. Used only inside the
 * pathfinding search itself, tile by tile
 */
function computeZoneThreatFraction(
	grid: Grid,
	owners: ThreatOwner[],
	tile: GridCoord,
	moverStats: MercenaryStats,
): number {
	let totalDamage = 0;
	for (const owner of owners) {
		if (!zoneReaches(grid, owner, tile)) continue;
		totalDamage += resolveReactionStrike(owner.stats, moverStats).damage;
	}
	return moverStats.maxHp > 0 ? totalDamage / moverStats.maxHp : 0;
}

/**
 * The whole-path version — reuses findZonesCrossed so this counts zones
 * the exact same way the real move execution will (one charge per
 * distinct owner crossed, not per tile)
 */
export function computePathThreatFraction(
	grid: Grid,
	path: GridCoord[],
	zoneOwners: ThreatOwner[],
	moverStats: MercenaryStats,
	moverCurrentHp: number,
): number {
	const crossings = findZonesCrossed(grid, path, zoneOwners);
	let totalDamage = 0;
	for (const crossing of crossings) {
		const owner = zoneOwners.find((o) => o.id === crossing.owner.id);
		if (!owner) continue;
		totalDamage += resolveReactionStrike(owner.stats, moverStats).damage;
	}
	return moverCurrentHp > 0 ? totalDamage / moverCurrentHp : 0;
}

/**
 * Zone-aware movement range — same shape and contract as the plain
 * computeMovementRange, but uses Dijkstra instead of BFS, since tiles no
 * longer cost a uniform 1 step. A simple linear-scan "find cheapest open
 * tile" is used rather than a proper heap — grid sizes here are small and
 * search is bounded by movementBudget, not the whole map, so this stays
 * fast without the added complexity of a real priority queue.
 */
export function computeMovementRangeWeighted(
	grid: Grid,
	start: GridCoord,
	movementBudget: number,
	blockedTiles: Set<string> | undefined,
	zoneOwners: ThreatOwner[],
	moverStats: MercenaryStats,
	archetype: AiArchetype,
): Map<string, MovementRangeEntry> {
	const multiplier = ARCHETYPE_ZOC_COST_MULTIPLIER[archetype];
	const best = new Map<string, MovementRangeEntry>();
	const startKey = coordKey(start);
	best.set(startKey, { coord: start, distance: 0, cameFrom: null });

	interface OpenEntry {
		coord: GridCoord;
		key: string;
		cost: number;
	}

	const open: OpenEntry[] = [{ coord: start, key: startKey, cost: 0 }];
	const closed = new Set<string>();

	while (open.length > 0) {
		let bestIdx = 0;
		for (let i = 1; i < open.length; i++) {
			if (open[i].cost < open[bestIdx].cost) bestIdx = i;
		}
		const current = open.splice(bestIdx, 1)[0];
		if (closed.has(current.key)) continue;
		closed.add(current.key);

		for (const neighbour of grid.getNeighbors(current.coord)) {
			const key = coordKey(neighbour);
			if (closed.has(key)) continue;
			if (!grid.isWalkable(neighbour)) continue;
			if (blockedTiles?.has(key)) continue;

			const threatFraction = computeZoneThreatFraction(
				grid,
				zoneOwners,
				neighbour,
				moverStats,
			);
			const newCost = current.cost + 1 + threatFraction * multiplier;
			if (newCost > movementBudget) continue;

			const existing = best.get(key);
			if (!existing || newCost < existing.distance) {
				best.set(key, {
					coord: neighbour,
					distance: newCost,
					cameFrom: current.coord,
				});
				open.push({ coord: neighbour, key, cost: newCost });
			}
		}
	}

	return best;
}
