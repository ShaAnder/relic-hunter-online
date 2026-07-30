import type { EnemyEntity } from "@/types/entities";
import { createMercenary, createAiMemory } from "@relic-hunter/shared";
import type { GridCoord, ItemData } from "@relic-hunter/shared";
import { Mercenary } from "@/entities/Mercenary";

/**
 * Debug-only defenseless hunter, 2 tiles from a given origin, carrying
 * one test item — isolates defeat/surrender item-theft testing from
 * real AI behavior. Never import this outside dev/debug code paths.
 * @param origin - anchor coord, typically the player's spawn position
 */
export function spawnTestHunter(origin: GridCoord): EnemyEntity {
	const coord = { x: origin.x + 2, y: origin.y };

	const state = createMercenary("test_hunter", coord, {
		movement: 0,
		attack: 0,
		defense: 0,
		maxHp: 1,
		ap: 0,
	});
	state.items[0] = {
		id: "test_relic",
		name: "Test Relic",
		description: "A placeholder item for testing theft on defeat.",
	} as ItemData;

	const mercenary = new Mercenary(coord, 0xff00ff);

	return {
		state,
		mercenary,
		archetype: "aggressive",
		memory: createAiMemory(),
	};
}
