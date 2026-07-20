/**
 * Pure grid data structure and operations.
 *
 * This is part of the shared/game layer — it contains only data and pure functions,
 * with no PixiJS, no Colyseus, and no DOM references. It is designed to be used by
 * both the client (for rendering) and the server (for authoritative validation).
 *
 * The underlying grid is square/orthogonal. Isometric projection is a rendering
 * concern only (handled in DungeonScene), not part of the grid data model.
 *
 * @see DungeonScene (for isometric rendering)
 */
export enum TileType {
	/** Normal walkable tile */
	Floor = "floor",
	/** Impassable tile */
	Wall = "wall",
	/** Goal / extraction point */
	Exit = "exit",
}

/**
 * A coordinate on the grid.
 * Used everywhere that needs to reference a specific tile location.
 */
export interface GridCoord {
	x: number;
	y: number;
}

// exported coord key fucntion for SST coord
export function coordKey(coord: GridCoord): string {
	return `${coord.x},${coord.y}`;
}

/**
 * A single tile on the grid.
 * Kept minimal on purpose — additional state (traps, hunters standing here, etc.)
 * belongs in higher-level game state, not baked into every tile.
 */
export interface Tile {
	coord: GridCoord;
	type: TileType;
	elevation: number;
}

export class Grid {
	readonly width: number;
	readonly height: number;

	/** Internal storage for tiles. String key = "x,y" for easy network compatibility. */
	private tiles: Map<string, Tile>;

	constructor(
		width: number,
		height: number,
		defaultType: TileType = TileType.Floor,
	) {
		this.width = width;
		this.height = height;
		this.tiles = new Map();

		// Initialize every cell as a floor tile.
		// Real dungeon generation (walls, exits, etc.) will happen later via setTileType.
		for (let x = 0; x < width; x++) {
			for (let y = 0; y < height; y++) {
				const coord = { x, y };
				this.tiles.set(Grid.key(coord), {
					coord,
					type: defaultType,
					elevation: 0,
				});
			}
		}
	}

	/**
	 * Converts a coordinate into the internal Map key.
	 * Private because this is an implementation detail.
	 */
	private static key(coord: GridCoord): string {
		return coordKey(coord);
	}

	/**
	 * Returns the tile at the given coordinate, or undefined if out of bounds
	 * or the coordinate was never populated.
	 */
	getTile(coord: GridCoord): Tile | undefined {
		return this.tiles.get(Grid.key(coord));
	}

	/**
	 * Changes the type of a tile.
	 * Note: This mutates the Tile object in place. This is acceptable for Phase 1
	 * and aligns with how Colyseus state syncing works (in-place mutation for change detection).
	 */
	setTileType(coord: GridCoord, type: TileType): void {
		const tile = this.getTile(coord);
		if (!tile) return;
		tile.type = type;
	}

	/**
	 * Checks if a coordinate is inside the grid bounds.
	 * Pure geometric check — does not care if a Tile actually exists at that position.
	 */
	isInBounds(coord: GridCoord): boolean {
		return (
			coord.x >= 0 &&
			coord.x < this.width &&
			coord.y >= 0 &&
			coord.y < this.height
		);
	}

	/**
	 * Checks if a tile can be walked on.
	 * A tile is walkable if it exists and is not a Wall.
	 */
	isWalkable(coord: GridCoord): boolean {
		const tile = this.getTile(coord);
		return tile !== undefined && tile.type !== TileType.Wall;
	}

	/**
	 * Returns the four orthogonal neighbors that are inside the grid bounds.
	 */
	getNeighbors(coord: GridCoord): GridCoord[] {
		const candidates: GridCoord[] = [
			{ x: coord.x + 1, y: coord.y },
			{ x: coord.x - 1, y: coord.y },
			{ x: coord.x, y: coord.y + 1 },
			{ x: coord.x, y: coord.y - 1 },
		];
		return candidates.filter((c) => this.isInBounds(c));
	}
}

/**
 * Find the first walkable tile looping through the grid map, to spawn test mercenary, if no
 * tile found (map not loaded) return null instead.
 *
 * @param grid Grid map
 * @returns grid coordinate or null
 */
export function findFirstWalkableTile(grid: Grid): GridCoord | null {
	for (let x = 0; x < grid.width; x++) {
		for (let y = 0; y < grid.height; y++) {
			const coord = { x, y };
			if (grid.isWalkable(coord)) return coord;
		}
	}
	return null;
}

/**
 * Scan the grid for the Exit tile. There's exactly one per generated map
 * (see generation.ts), so the first match found is returned.
 *
 * @param grid Grid map
 * @returns grid coordinate or null if no Exit tile exists
 */
export function findExitTile(grid: Grid): GridCoord | null {
	for (let x = 0; x < grid.width; x++) {
		for (let y = 0; y < grid.height; y++) {
			const coord = { x, y };
			const tile = grid.getTile(coord);
			if (tile?.type === TileType.Exit) return coord;
		}
	}
	return null;
}
