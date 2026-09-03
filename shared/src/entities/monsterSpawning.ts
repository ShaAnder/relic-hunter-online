import type { RandomFn } from "../math/random";

export const MAX_MONSTERS = 5;
export const MONSTER_SPAWN_CHANCE = 0.15;

/**
 * Whether a monster should spawn right now — rolled once between EVERY
 * mercenary's turn (player and each AI hunter individually, not once per
 * round), only ever true if under the population cap.
 */
export function shouldSpawnMonster(
	currentMonsterCount: number,
	rng: RandomFn,
): boolean {
	if (currentMonsterCount >= MAX_MONSTERS) return false;
	return rng() < MONSTER_SPAWN_CHANCE;
}
