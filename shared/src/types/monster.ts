import type { GridCoord } from "../world/grid";
import type { MercenaryState, MercenaryStats } from "./mercenary";

export type MonsterTier = "light" | "medium" | "heavy";

/**
 * Non-hunter map entity — set stats per tier / variant
 * No hand, items always melee for now, Stats sit above hunter
 * for testing atm
 */
export interface MonsterState {
	id: string;
	tier: MonsterTier;
	coord: GridCoord;
	stats: MercenaryStats;
	currentHp: number;
}

/** First-pass tier stats, each meaningfully stronger than the last. NOT TUNED */
export const MONSTER_TIER_STATS: Record<MonsterTier, MercenaryStats> = {
	light: { movement: 3, attack: 4, defense: 2, maxHp: 12, ap: 3 },
	medium: { movement: 3, attack: 5, defense: 3, maxHp: 18, ap: 3 },
	heavy: { movement: 2, attack: 7, defense: 4, maxHp: 26, ap: 3 },
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
 * Presents a MonsterState as a MercenaryState so it can pass through
 * BattleOverlay unchanged — empty hand (so chooseCombatAction naturally
 * falls back to card: undefined), empty items (nothing to loot), no real
 * characterClass since monsters don't use ranged/caster targeting logic (yet)./
 */
export function monsterAsMercenaryState(monster: MonsterState): MercenaryState {
	return {
		id: monster.id,
		coord: monster.coord,
		stats: monster.stats,
		characterClass: "brawler",
		currentHp: monster.currentHp,
		hpCeiling: monster.stats.maxHp,
		items: new Array(6).fill(null),
		hand: [],
	};
}
