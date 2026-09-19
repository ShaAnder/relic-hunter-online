import type { Grid, GridCoord } from "../world/grid";

import type { ZoneOwner } from "../combat/zoneOfControl";

import { findZonesCrossed, zoneReaches } from "../combat/zoneOfControl";

import type { MercenaryStats } from "../types/mercenary";

import { resolveReactionStrike } from "../combat/combat";

import type { AiArchetype } from "./mercenaryAI";

/**
 * A zone owner carrying enough combat data to estimate the real
 * reaction-strike threat against a mover.
 */
export interface ThreatOwner extends ZoneOwner {
	stats: MercenaryStats;
}

/**
 * AI pathing policy only.
 *
 * These values influence which route an AI prefers.
 * They are NOT literal movement points spent by the actor.
 */
export const ARCHETYPE_ZOC_COST_MULTIPLIER: Record<AiArchetype, number> = {
	aggressive: 5,
	balanced: 10,
	treasure: 20,
	passive: 30,
	clever: 8,
};

/**
 * Hard refusal threshold based on expected damage as a fraction of
 * current HP.
 */
export const ARCHETYPE_ZOC_REFUSAL_THRESHOLD: Record<AiArchetype, number> = {
	aggressive: 0.6,
	balanced: 0.4,
	treasure: 0.25,
	passive: 0.15,
	clever: 0.35,
};

function computeZoneThreatFraction(
	grid: Grid,
	owners: ThreatOwner[],
	tile: GridCoord,
	moverStats: MercenaryStats,
): number {
	let totalDamage = 0;

	for (const owner of owners) {
		if (!zoneReaches(grid, owner, tile)) {
			continue;
		}

		totalDamage += resolveReactionStrike(owner.stats, moverStats).damage;
	}

	return moverStats.maxHp > 0 ? totalDamage / moverStats.maxHp : 0;
}

/**
 * Additive ZoC POLICY cost for entering a tile.
 *
 * Pathfinding itself lives in world/movement.ts.
 */
export function getZocStepPenalty(
	grid: Grid,
	owners: ThreatOwner[],
	to: GridCoord,
	moverStats: MercenaryStats,
	archetype: AiArchetype,
): number {
	const threatFraction = computeZoneThreatFraction(
		grid,
		owners,
		to,
		moverStats,
	);

	return threatFraction * ARCHETYPE_ZOC_COST_MULTIPLIER[archetype];
}

/**
 * Whole-path danger calculation.
 *
 * Real reaction strikes remain one charge per distinct zone owner
 * crossed, not one strike for every threatened tile.
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
		const owner = zoneOwners.find(
			(candidate) => candidate.id === crossing.owner.id,
		);

		if (!owner) {
			continue;
		}

		totalDamage += resolveReactionStrike(owner.stats, moverStats).damage;
	}

	return moverCurrentHp > 0 ? totalDamage / moverCurrentHp : 0;
}
