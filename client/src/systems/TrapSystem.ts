import { Container, Graphics } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";

export type TrapHazardHit = {
	kind: RH.TrapKind;
	result: RH.HazardRollResult;
};

/**
 * Owns placed traps, visibility queries, marker rendering, and path
 * resolution. Feedback strings and post-stun turn flow stay on MapScene.
 * @author ShaAnder
 */
export class TrapSystem {
	private traps: RH.Trap[] = [];
	readonly markerContainer = new Container();

	get all(): readonly RH.Trap[] {
		return this.traps;
	}

	place(params: {
		coord: RH.GridCoord;
		ownerId: string;
		kind: RH.TrapKind;
	}): RH.Trap {
		const trap: RH.Trap = {
			id: `trap_${Date.now()}_${this.traps.length}`,
			coord: params.coord,
			ownerId: params.ownerId,
			kind: params.kind,
		};
		this.traps.push(trap);
		return trap;
	}

	visibleTo(
		viewerId: string,
		viewerCoord: RH.GridCoord,
		viewerIsHunterClass: boolean,
	): RH.Trap[] {
		return this.traps.filter((t) =>
			RH.canSeeTrap(t, viewerId, viewerCoord, viewerIsHunterClass),
		);
	}

	renderMarkersFor(
		viewerId: string,
		viewerCoord: RH.GridCoord,
		viewerIsHunterClass: boolean,
	): void {
		this.markerContainer.removeChildren();
		for (const trap of this.visibleTo(
			viewerId,
			viewerCoord,
			viewerIsHunterClass,
		)) {
			const pos = gridToScreen(trap.coord);
			const g = new Graphics();
			g.poly([
				0,
				-TILE_HEIGHT / 2,
				TILE_WIDTH / 2,
				0,
				0,
				TILE_HEIGHT / 2,
				-TILE_WIDTH / 2,
				0,
			]);
			g.fill({ color: 0x2ecc71, alpha: 0.4 });
			g.stroke({ width: 2, color: 0x2ecc71, alpha: 0.8 });
			g.x = pos.x;
			g.y = pos.y;
			this.markerContainer.addChild(g);
		}
	}

	/**
	 * Walk path in order. First trap that lands truncates the path.
	 * Resisted traps are removed without truncating (same as MapScene did).
	 */
	resolveAlongPath(
		path: RH.GridCoord[],
		victimStats: RH.MercenaryStats,
		temporaryDefenseBonus: RH.CardData["value"] | 0,
		rng: RH.RandomFn,
	): {
		truncatedPath: RH.GridCoord[];
		hazardHit: TrapHazardHit | null;
		resists: { hazardRoll: number; victimRoll: number }[];
	} {
		const resists: { hazardRoll: number; victimRoll: number }[] = [];

		for (let i = 0; i < path.length; i++) {
			const step = path[i];
			const index = this.traps.findIndex(
				(t) => t.coord.x === step.x && t.coord.y === step.y,
			);
			if (index === -1) continue;

			const trap = this.traps[index];
			this.traps.splice(index, 1);

			const bonus = temporaryDefenseBonus;
			const syntheticCard: RH.CardData | undefined =
				bonus !== 0
					? {
							id: "__temp_defense__",
							color: "yellow",
							name: "Defense",
							value: bonus,
							description: "",
							actionType: "defense",
						}
					: undefined;

			const result = RH.resolveHazardRoll(victimStats, rng, syntheticCard);

			if (!result.landed) {
				resists.push({
					hazardRoll: result.hazardRoll,
					victimRoll: result.victimRoll,
				});
				continue;
			}

			return {
				truncatedPath: path.slice(0, i + 1),
				hazardHit: { kind: trap.kind, result },
				resists,
			};
		}

		return { truncatedPath: path, hazardHit: null, resists };
	}
}
