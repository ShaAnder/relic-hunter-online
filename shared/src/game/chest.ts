import type { ItemData } from "./item";
import { pickTargetItem, itemsByCategory } from "./item";

const MIN_CHESTS = 10;
const MAX_CHESTS = 15;

export interface ChestPlan {
	id: string;
	item: ItemData;
	/** True for the one chest guaranteed to hold this match's target item. */
	isTarget: boolean;
}

/**
 * Plan this match's chests: a random count in [10,15], one item chosen as
 * the match's target and guaranteed to appear in exactly one chest, every
 * other chest filled with an independently-random item from the same pool
 * — duplicates, including of the target itself, are fine and harmless.
 * There's no separate "relic" tier gating which items can be a target;
 * any item in the pool is eligible (see `04-item-inventory-win-design.md`).
 *
 * This only produces the plan (which chest holds what). Placing each chest
 * on an actual walkable map tile is a MapScene/LoadingScene concern — this
 * function has no idea what the map even looks like.
 */
export function planChests(): { chests: ChestPlan[]; targetItem: ItemData } {
	const chestCount =
		MIN_CHESTS + Math.floor(Math.random() * (MAX_CHESTS - MIN_CHESTS + 1));
	const targetItem = pickTargetItem();
	const pool = itemsByCategory("loot");
	const targetChestIndex = Math.floor(Math.random() * chestCount);

	const chests: ChestPlan[] = [];
	for (let i = 0; i < chestCount; i++) {
		const isTarget = i === targetChestIndex;
		const item = isTarget
			? targetItem
			: pool[Math.floor(Math.random() * pool.length)];

		chests.push({ id: `chest_${i}`, item, isTarget });
	}

	return { chests, targetItem };
}
