import type { GridCoord } from "@relic-hunter/shared";

export const DEFAULT_RENDER_CHUNK_SIZE = 8;

export interface RenderChunkCoord {
	x: number;
	y: number;
}

export type RenderChunkId = string & {
	readonly __renderChunkId: unique symbol;
};

export function renderChunkCoordFor(
	coord: GridCoord,
	chunkSize = DEFAULT_RENDER_CHUNK_SIZE,
): RenderChunkCoord {
	return {
		x: Math.floor(coord.x / chunkSize),
		y: Math.floor(coord.y / chunkSize),
	};
}

export function renderChunkIdForTile(
	coord: GridCoord,
	chunkSize = DEFAULT_RENDER_CHUNK_SIZE,
): RenderChunkId {
	const chunk = renderChunkCoordFor(coord, chunkSize);
	return `${chunk.x},${chunk.y}` as RenderChunkId;
}
