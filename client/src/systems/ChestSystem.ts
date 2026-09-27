import * as RH from "@relic-hunter/shared";
import { Chest } from "@/entities/Chest";
import type { DynamicWorldRenderer } from "@/rendering/engine/dynamic/DynamicWorldRenderer";

/**
 * A chest placed on the map, tying its visual entity to its plan and position.
 */
export interface PlacedChest {
	id: string;
	coord: RH.GridCoord;
	plan: RH.ChestPlan;
	entity: Chest;
	floorIndex: number;
}

export type ChestOpenOutcome =
	| {
			kind: "noChest";
	  }
	| {
			kind: "inventoryFull";
	  }
	| {
			kind: "opened";
			item: RH.ItemData;
			isTarget: boolean;
	  };

/**
 * Owns placed chest lifecycle/gameplay state.
 * DynamicWorldRenderer owns only scene attachment + live visibility.
 */
export class ChestSystem {
	private placedChests: PlacedChest[] = [];
	constructor(private readonly dynamicWorld: DynamicWorldRenderer) {}
	get all(): readonly PlacedChest[] {
		return this.placedChests;
	}

	private clearPlacedChests(): void {
		for (const placed of this.placedChests) {
			this.dynamicWorld.unregister(placed.id);
			placed.entity.view.destroy({
				children: true,
			});
		}
		this.placedChests = [];
	}

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

			const placed: PlacedChest = {
				id: chestRenderId(record.floorIndex, record.coord, record.plan),
				coord: record.coord,
				plan: record.plan,
				entity,
				floorIndex: record.floorIndex,
			};
			this.placedChests.push(placed);
			this.registerDynamicChest(placed);
		}
	}

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
			if (!coord) {
				break;
			}
			used.add(RH.coordKey(coord));
			const entity = new Chest(coord, elevation);
			const placed: PlacedChest = {
				id: chestRenderId(floorIndex, coord, chestPlan),
				coord,
				plan: chestPlan,
				entity,
				floorIndex,
			};
			this.placedChests.push(placed);
			this.registerDynamicChest(placed);
		}
	}

	tryOpen(
		coord: RH.GridCoord,
		items: (RH.ItemData | null)[],
	): ChestOpenOutcome {
		const placed = this.placedChests.find(
			(chest) =>
				!chest.entity.isOpen &&
				chest.coord.x === coord.x &&
				chest.coord.y === coord.y,
		);

		if (!placed) {
			return {
				kind: "noChest",
			};
		}

		const emptyIndex = items.findIndex((item) => item === null);
		if (emptyIndex === -1) {
			return {
				kind: "inventoryFull",
			};
		}
		placed.entity.open();
		items[emptyIndex] = placed.plan.item;

		return {
			kind: "opened",
			item: placed.plan.item,
			isTarget: placed.plan.isTarget,
		};
	}

	private registerDynamicChest(placed: PlacedChest): void {
		this.dynamicWorld.register({
			id: placed.id,
			kind: "chest",
			view: placed.entity.view,
			renderKind: "procedural",
			lifetime: "stateful",
			getFloorIndex: () => placed.floorIndex,
			getCoord: () => placed.coord,
		});
	}
}

function chestRenderId(
	floorIndex: number,
	coord: RH.GridCoord,
	plan: RH.ChestPlan,
): string {
	return ["chest", floorIndex, `${coord.x},${coord.y}`, plan.item.id].join(":");
}
