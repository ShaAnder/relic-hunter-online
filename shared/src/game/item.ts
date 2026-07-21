/**
 * Item categories.
 *
 * There's no separate "relic" tier — every item in the "loot" category is
 * an equally valid candidate to be designated a match's target (see
 * chest.ts). They're all relics in essence; "target" is just a role one
 * of them gets assigned for a given match, not a fixed property of the
 * item itself.
 *
 * "gear" is reserved for a future pass — the inventory UI has 3 fixed
 * Gear slots, but no gear items exist in the pool yet.
 */
export type ItemCategory = "loot" | "gear";

export interface ItemData {
	id: string;
	name: string;
	category: ItemCategory;
	description: string;
}

/**
 * Flat item pool for Phase 1 — no rarity or weighting yet, every item is
 * equally likely to fill a chest or be picked as the match's target.
 */
export const ITEM_POOL: ItemData[] = [
	{
		id: "ember_crown",
		name: "Ember Crown",
		category: "loot",
		description: "A crown said to burn with the fury of a fallen king.",
	},
	{
		id: "tide_shard",
		name: "Tide Shard",
		category: "loot",
		description: "A fragment of coral that hums with the ocean's memory.",
	},
	{
		id: "hollow_eye",
		name: "Hollow Eye",
		category: "loot",
		description: "A carved idol's eye, said to still be watching.",
	},
	{
		id: "moonlit_key",
		name: "Moonlit Key",
		category: "loot",
		description: "Fits no lock anyone still living remembers.",
	},
	{
		id: "wyrm_tooth",
		name: "Wyrm Tooth",
		category: "loot",
		description: "Longer than a forearm, still faintly warm.",
	},
	{
		id: "ashen_locket",
		name: "Ashen Locket",
		category: "loot",
		description: "The portrait inside has worn away to nothing.",
	},
	{
		id: "gilded_femur",
		name: "Gilded Femur",
		category: "loot",
		description: "Someone thought this bone was worth plating in gold.",
	},
	{
		id: "storm_lantern",
		name: "Storm Lantern",
		category: "loot",
		description: "Its flame doesn't flicker, even outdoors.",
	},
	{
		id: "sunken_bell",
		name: "Sunken Bell",
		category: "loot",
		description: "Rings a note no living ear should be able to hear.",
	},
	{
		id: "thorned_crown",
		name: "Thorned Crown",
		category: "loot",
		description: "Whoever wore this last didn't take it off willingly.",
	},
	{
		id: "gold_coin",
		name: "Gold Coin",
		category: "loot",
		description: "A tarnished coin from a forgotten mint.",
	},
	{
		id: "old_map",
		name: "Old Map",
		category: "loot",
		description: "Torn and stained, but the ink still holds.",
	},
	{
		id: "bone_charm",
		name: "Bone Charm",
		category: "loot",
		description: "Carved bone strung on leather cord.",
	},
	{
		id: "broken_compass",
		name: "Broken Compass",
		category: "loot",
		description: "Its needle spins freely — north was never the point.",
	},
	{
		id: "sealed_letter",
		name: "Sealed Letter",
		category: "loot",
		description: "Addressed to no one, sealed with wax gone black.",
	},
];

/** All items in a given category. */
export function itemsByCategory(category: ItemCategory): ItemData[] {
	return ITEM_POOL.filter((item) => item.category === category);
}

/** Look up a single item by id. Returns undefined if the id doesn't exist. */
export function findItemById(id: string): ItemData | undefined {
	return ITEM_POOL.find((item) => item.id === id);
}

/**
 * Pick one item at random from the full loot pool to be this match's
 * target. Any item can be the target — there's no separate "relic" tier
 * gating eligibility.
 */
export function pickTargetItem(): ItemData {
	const pool = itemsByCategory("loot");
	return pool[Math.floor(Math.random() * pool.length)];
}
