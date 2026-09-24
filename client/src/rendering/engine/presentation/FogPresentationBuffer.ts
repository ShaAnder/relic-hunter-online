import * as RH from "@relic-hunter/shared";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type { CompiledFloorVisual } from "../compiler/CompiledFloorVisual";

export enum FogCode {
	// Compact numeric states stored directly in the fog presentation buffer.
	Unseen = 0,
	Explored = 1,
	Visible = 2,
}

// Bundles the game-state information needed to resolve visibility for a tile.
export interface FogPresentationSource {
	state: RH.HasFogOfWar;
	center: RH.GridCoord;
	turn: number;
}

/**
 * Compact CPU copy of ground fog state.
 *
 * One byte corresponds to one logical map coordinate. Updating fog compares
 * the next state to the previous code and reports only chunks containing a
 * changed tile.
 */
export class FogPresentationBuffer {
	private readonly codes: Uint8Array;

	constructor(
		private readonly width: number,
		private readonly height: number,
	) {
		// Flatten the 2D floor into one compact entry per coordinate.
		this.codes = new Uint8Array(width * height);

		// 255 means "not initialized" so the first update treats every tile as changed.
		this.codes.fill(255);
	}

	update(
		compiled: CompiledFloorVisual,
		fog: FogPresentationSource | null,
	): ReadonlySet<RenderChunkId> {
		if (compiled.width !== this.width || compiled.height !== this.height) {
			throw new Error(
				"FogPresentationBuffer.update: compiled floor dimensions changed",
			);
		}
		// Track only chunks whose fog presentation actually changed this update.
		const dirtyChunks = new Set<RenderChunkId>();

		for (const tile of compiled.tiles) {
			// Convert the tile's 2D coordinate into its position in the flat fog buffer.
			const index = this.indexFor(tile.coord);
			const next = this.resolveFogCode(tile.coord, fog);

			// Unchanged tiles require no renderer work.
			if (this.codes[index] === next) {
				continue;
			}

			// Store the new state and flag this tile's render chunk for refresh.
			this.codes[index] = next;
			dirtyChunks.add(tile.chunkId);
		}

		return dirtyChunks;
	}

	codeAtIndex(index: number): FogCode {
		// check what the code at index is
		const code = this.codes[index];

		// check the coced type
		if (
			code === FogCode.Unseen ||
			code === FogCode.Explored ||
			code === FogCode.Visible
		) {
			return code;
		}

		// tiles queried before unseen should fail closed
		return FogCode.Unseen;
	}

	// Flatten (x, y) into a row-major array index: y * width + x.
	private indexFor(coord: RH.GridCoord): number {
		return coord.y * this.width + coord.x;
	}

	// Translate shared game visibility into the compact code used by rendering.
	private resolveFogCode(
		coord: RH.GridCoord,
		fog: FogPresentationSource | null,
	): FogCode {
		if (!fog) {
			return FogCode.Visible;
		}

		const visibility = RH.getTileVisibility(
			fog.state,
			coord,
			fog.center,
			fog.turn,
		);

		switch (visibility) {
			case "unseen":
				return FogCode.Unseen;
			case "explored":
				return FogCode.Explored;
			case "visible":
				return FogCode.Visible;
		}
	}
}
