import type { Container } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import { Chest } from "@/entities/Chest";

/** A chest placed on the map, tying its visual entity to its plan and position. */
export interface PlacedChest {
	coord: RH.GridCoord;
	plan: RH.ChestPlan;
	entity: Chest;
	floorIndex: number;
}

export type ChestOpenOutcome =
	| { kind: "noChest" }
	| { kind: "inventoryFull" }
	| { kind: "opened"; item: RH.ItemData; isTarget: boolean };

/**
 * Owns placed chests — construction from either a saved session layout
 * or a fresh plan, and the open/inventory-check itself. Feedback
 * strings, frenzy, and exit-spawning are all consequences MapScene
 * decides on from the returned outcome; this never calls back into it.
 * @author ShaAnder
 */
export class ChestSystem {
	private placedChests: PlacedChest[] = [];
	constructor(private worldDepthContainer: Container) {}
	get all(): readonly PlacedChest[] {
		return this.placedChests;
	}

	private clearPlacedChests(): void {
		for (const placed of this.placedChests) {
			placed.entity.view.removeFromParent();
			placed.entity.view.destroy({
				children: true,
			});
		}
		this.placedChests = [];
	}

	/** Rebuilds from session's already-decided placements — a returning player, not a fresh match. */
	spawnFromPlacements(
		records: {
			coord: RH.GridCoord;
			plan: RH.ChestPlan;
			floorIndex: number;
		}[],
		floors?: readonly RH.CompiledEdgeMap[],
	): void {
		this.clearPlacedChests();
		for (const record of records) {
			const entity = new Chest(
				record.coord,
				floors?.[record.floorIndex]?.elevation,
			);
			this.worldDepthContainer.addChild(entity.view);
			this.placedChests.push({
				coord: record.coord,
				plan: record.plan,
				entity,
				floorIndex: record.floorIndex,
			});
		}
	}

	/** Fresh match — spreads chests across walkable tiles, avoiding every coord in reserved. */
	spawnFromPlan(
		plan: {
			chests: RH.ChestPlan[];
		},
		grid: RH.Grid,
		reserved: Set<string>,
		rng: RH.RandomFn,
		floorIndex = 0,
		elevation?: Map<string, number>,
	): void {
		this.clearPlacedChests();

		const used = new Set(reserved);
		for (const chestPlan of plan.chests) {
			const coord = RH.pickSpreadWalkableTile(grid, used, rng);
			if (!coord) break;
			used.add(RH.coordKey(coord));
			const entity = new Chest(coord, elevation);
			this.worldDepthContainer.addChild(entity.view);
			this.placedChests.push({ coord, plan: chestPlan, entity, floorIndex });
		}
	}

	/**
	 * Opens the unopened chest at coord into the first empty items slot,
	 * mutating items in place exactly like the old direct-field write
	 * did. Returns which of the three outcomes happened so the caller
	 * can decide feedback/frenzy/exit-spawning without this system
	 * knowing any of those exist.
	 */
	tryOpen(
		coord: RH.GridCoord,
		items: (RH.ItemData | null)[],
	): ChestOpenOutcome {
		const placed = this.placedChests.find(
			(c) => !c.entity.isOpen && c.coord.x === coord.x && c.coord.y === coord.y,
		);
		if (!placed) return { kind: "noChest" };

		const emptyIndex = items.findIndex((i) => i === null);
		if (emptyIndex === -1) return { kind: "inventoryFull" };

		placed.entity.open();
		items[emptyIndex] = placed.plan.item;

		return {
			kind: "opened",
			item: placed.plan.item,
			isTarget: placed.plan.isTarget,
		};
	}
}
