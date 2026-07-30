import type { EnemyEntity } from "@/types/entities";
import { createMercenary, createAiMemory } from "@relic-hunter/shared";
import type { GridCoord, ItemData } from "@relic-hunter/shared";
import { Mercenary } from "@/entities/Mercenary";
import type { Grid } from "@relic-hunter/shared";

/**
 * Debug-only defenseless hunter, 2 tiles from a given origin, carrying
 * one test item — isolates defeat/surrender item-theft testing from
 * real AI behavior. Never import this outside dev/debug code paths.
 * @param origin - anchor coord, typically the player's spawn position
 */
export function spawnTestHunter(grid: Grid, origin: GridCoord): EnemyEntity {
	const coord = findNearbyWalkableTile(grid, origin, { x: 2, y: 0 });

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

/** Debug-only hunter tuned to always Surrender via chooseCombatAction's
 * real decision path — power ratio guarantees shouldFlee regardless of
 * current HP, low movement guarantees canLikelyEscape fails, forcing
 * Surrender over Run. Nothing about this bypasses real combat logic. */
export function spawnSurrenderTestHunter(
	grid: Grid,
	origin: GridCoord,
): EnemyEntity {
	const coord = findNearbyWalkableTile(grid, origin, { x: -2, y: 0 });

	const state = createMercenary("test_surrenderer", coord, {
		movement: 1,
		attack: 1,
		defense: 1,
		maxHp: 8,
		ap: 0,
	});
	state.items[0] = {
		id: "test_relic_surrender",
		name: "Surrender Relic",
		description: "Placeholder item for testing the surrender loot path.",
	} as ItemData;

	const mercenary = new Mercenary(coord, 0x00ffff);

	return { state, mercenary, archetype: "balanced", memory: createAiMemory() };
}

/** Walkable tile near a preferred offset from origin — falls back to a widening search ring if that exact spot isn't valid (off-map, a wall, etc). */
function findNearbyWalkableTile(
	grid: Grid,
	origin: GridCoord,
	preferredOffset: GridCoord,
): GridCoord {
	const preferred = {
		x: origin.x + preferredOffset.x,
		y: origin.y + preferredOffset.y,
	};
	if (grid.isWalkable(preferred)) return preferred;

	for (let radius = 1; radius <= 5; radius++) {
		for (let dx = -radius; dx <= radius; dx++) {
			for (let dy = -radius; dy <= radius; dy++) {
				const candidate = { x: origin.x + dx, y: origin.y + dy };
				if (grid.isWalkable(candidate)) return candidate;
			}
		}
	}
	return origin; // last resort, shouldn't be hit on any real generated map
}
