import * as RH from "@relic-hunter/shared";

/** The minimal shape ZoneQuery needs from a unit — EntityCore plus the overwatch flag. */
export interface OverwatchCandidate extends RH.EntityCore {
	special: string | null;
}

/**
 * Pure zone-of-control ownership queries — which units currently
 * project a zone, derived fresh each call from whatever units are
 * passed in. No MapScene knowledge, no state of its own. The
 * animated, timed part of actually crossing a zone (pausing,
 * applying a strike, showing feedback) stays on MapScene — that's
 * presentation sequencing, not a query.
 * @author ShaAnder
 */
export const ZoneQuery = {
	buildZoneOwners(
		units: OverwatchCandidate[],
		excludeId: string,
	): RH.ZoneOwner[] {
		return units
			.filter(
				(u) => u.id !== excludeId && u.currentHp > 0 && u.special === "overwatch",
			)
			.map((u) => ({ id: u.id, coord: u.coord, zocRadius: 2 }));
	},

	buildThreatZoneOwners(
		units: OverwatchCandidate[],
		excludeId: string,
	): RH.ThreatOwner[] {
		return units
			.filter(
				(u) => u.id !== excludeId && u.currentHp > 0 && u.special === "overwatch",
			)
			.map((u) => ({
				id: u.id,
				coord: u.coord,
				zocRadius: 2,
				stats: u.stats,
			}));
	},
};
