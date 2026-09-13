import type { GridCoord } from "../grid";

export type StaircaseOrientation = "horizontal" | "vertical";

export interface StaircaseCluster {
	tiles: GridCoord[];
	orientation: StaircaseOrientation;
	/** The tile(s) at the top of the climb — the only ones that should trigger a floor switch. For "horizontal" this is the rightmost column of the cluster (left-to-right climb); for "vertical" it's the lowest-Y row (south-to-north climb, since north is -Y here). */
	topTiles: GridCoord[];
	/** The tile(s) at the bottom of the climb — where descending from the floor above arrives. */
	bottomTiles: GridCoord[];
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

/**
 * Groups a floor's stairs tiles into connected clusters (4-directional
 * flood fill) and determines each cluster's climb direction from its
 * own bounding-box shape — wider than tall reads as left-to-right,
 * taller than wide reads as south-to-north. This is a stand-in for
 * real per-tile direction data, which doesn't exist yet; a cluster
 * that's exactly as wide as it is tall defaults to horizontal, an
 * arbitrary but harmless tiebreak until directions are authored
 * explicitly.
 */
export function detectStaircaseClusters(
	stairsTiles: GridCoord[],
): StaircaseCluster[] {
	const tileSet = new Set(stairsTiles.map((c) => `${c.x},${c.y}`));
	const visited = new Set<string>();
	const clusters: StaircaseCluster[] = [];

	for (const start of stairsTiles) {
		const startKey = `${start.x},${start.y}`;
		if (visited.has(startKey)) continue;

		const tiles: GridCoord[] = [];
		const queue: GridCoord[] = [start];
		visited.add(startKey);

		while (queue.length > 0) {
			const current = queue.pop()!;
			tiles.push(current);
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const next = { x: current.x + dx, y: current.y + dy };
				const key = `${next.x},${next.y}`;
				if (!tileSet.has(key) || visited.has(key)) continue;
				visited.add(key);
				queue.push(next);
			}
		}

		const minX = Math.min(...tiles.map((t) => t.x));
		const maxX = Math.max(...tiles.map((t) => t.x));
		const minY = Math.min(...tiles.map((t) => t.y));
		const maxY = Math.max(...tiles.map((t) => t.y));
		const orientation: StaircaseOrientation =
			maxX - minX >= maxY - minY ? "horizontal" : "vertical";

		const topTiles =
			orientation === "horizontal"
				? tiles.filter((t) => t.x === maxX)
				: tiles.filter((t) => t.y === minY);
		const bottomTiles =
			orientation === "horizontal"
				? tiles.filter((t) => t.x === minX)
				: tiles.filter((t) => t.y === maxY);

		clusters.push({ tiles, orientation, topTiles, bottomTiles, minX, maxX, minY, maxY });
	}

	return clusters;
}

/** 0 at the bottom of the cluster's climb, 1 at the top — for a coord not in the cluster at all, still returns the nearest clamped value rather than throwing, since a caller checking "is this coord mid-climb" is simpler when it can't get an exception for a coord that just isn't on this staircase. */
export function staircaseClimbProgress(
	cluster: StaircaseCluster,
	coord: GridCoord,
): number {
	if (cluster.orientation === "horizontal") {
		const span = cluster.maxX - cluster.minX;
		if (span === 0) return 0;
		return Math.min(1, Math.max(0, (coord.x - cluster.minX) / span));
	}
	const span = cluster.maxY - cluster.minY;
	if (span === 0) return 0;
	return Math.min(1, Math.max(0, (cluster.maxY - coord.y) / span));
}

export function isTopOfStaircase(
	cluster: StaircaseCluster,
	coord: GridCoord,
): boolean {
	return cluster.topTiles.some((t) => t.x === coord.x && t.y === coord.y);
}

/** Finds whichever cluster (if any) contains coord — for the common case of "what staircase, if any, is the player currently standing on." */
export function findStaircaseClusterAt(
	clusters: StaircaseCluster[],
	coord: GridCoord,
): StaircaseCluster | null {
	return (
		clusters.find((c) =>
			c.tiles.some((t) => t.x === coord.x && t.y === coord.y),
		) ?? null
	);
}
