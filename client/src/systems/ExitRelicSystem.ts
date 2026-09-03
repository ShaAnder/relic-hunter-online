import * as RH from "@relic-hunter/shared";

/**
 * Decides where the match Exit spawns once the target relic is found.
 * Deliberately knows nothing about units or monsters directly — the
 * caller builds the blocked set from whatever it considers occupied.
 * @author ShaAnder
 */
export const ExitRelicSystem = {
	/**
	 * No-ops if an exit already exists on the grid. `from` is added to
	 * the blocked set automatically — callers only need to supply every
	 * other occupied tile.
	 */
	spawnFarFrom(
		grid: RH.Grid,
		from: RH.GridCoord,
		blockedExtra: Set<string>,
		rng: RH.RandomFn,
	): void {
		if (RH.findExitTile(grid)) return;

		const blocked = new Set(blockedExtra);
		blocked.add(RH.coordKey(from));

		const exitCoord = RH.pickExitFarFrom(grid, from, rng, blocked, 0.35);
		if (!exitCoord) {
			const fallback = RH.pickSpreadWalkableTile(grid, blocked, rng, 1, 1);
			if (!fallback) return;
			grid.setTileType(fallback, RH.TileType.Exit);
			return;
		}
		grid.setTileType(exitCoord, RH.TileType.Exit);
	},
};
