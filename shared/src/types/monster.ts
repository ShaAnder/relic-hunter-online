import type { GridCoord } from "../world/grid";
import type { EntityCore } from "./entity";
import type { MercenaryStats, MercenaryState } from "./mercenary";

export type MonsterTier = "light" | "medium" | "heavy";

/**
 * Non-hunter map entity — core only, plus tier. Has no hand,
 * no items, no character class — not faked, not present at all.
 */
export type MonsterState = EntityCore & { tier: MonsterTier };

/** First-pass tier stats, each meaningfully stronger than the last. NOT TUNED */
export const MONSTER_TIER_STATS: Record<MonsterTier, MercenaryStats> = {
	light: { movement: 3, attack: 4, defense: 2, maxHp: 12, ap: 3 },
	medium: { movement: 3, attack: 5, defense: 3, maxHp: 18, ap: 3 },
	heavy: { movement: 3, attack: 7, defense: 4, maxHp: 26, ap: 3 },
};

export function createMonster(
	id: string,
	tier: MonsterTier,
	coord: GridCoord,
): MonsterState {
	return {
		id,
		tier,
		coord,
		stats: MONSTER_TIER_STATS[tier],
		currentHp: MONSTER_TIER_STATS[tier].maxHp,
	};
}

/**
 * TEMPORARY BRIDGE — still needed only because BattleOverlay hasn't
 * been updated to read against EntityCore + trait-checks yet (a later
 * step in the composition rebuild). Once that lands, this adapter and
 * every call site of it should be deleted outright, not kept around.
 */
export function monsterAsMercenaryState(monster: MonsterState): MercenaryState {
	return {
		id: monster.id,
		coord: monster.coord,
		stats: monster.stats,
		characterClass: "brawler",
		name: "Monster",
		currentHp: monster.currentHp,
		hpCeiling: monster.stats.maxHp,
		items: new Array(6).fill(null),
		hand: [],
		// For TS structure monsters need a match score, however they will never use this, result of extending from merc state
		matchScore: {
			damageDealt: 0,
			itemsScore: 0,
			cardsRemaining: 0,
			environmentalScore: 0,
			tacticalScore: 0,
			objectiveTurnsHeld: 0,
		},
	};
}
