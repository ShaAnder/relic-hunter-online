import * as RH from "@relic-hunter/shared";
import { renderEdgeIdFor } from "../compiler/CompiledFloorVisual";
export interface BarrierFocusDiff {
	focusedEdgeIds: ReadonlySet<string>;

	changedEdgeIds: ReadonlySet<string>;
}

/**
 * Tracks which compiled structural edge IDs currently form the focused room<s
 * boundary.
 *
 * Room data stores tile-pair boundaries; the renderer patches buffers by the
 * compiler<s stable structural edge ID. This class is the conversion seam
 * between those identities.
 */
export class BarrierFocusBuffer {
	private focusedEdgeIds = new Set<string>();

	update(focusRoom: RH.Room | null): BarrierFocusDiff {
		const next = this.edgeIdsForRoom(focusRoom);
		const changed = new Set<string>();
		for (const edgeId of this.focusedEdgeIds) {
			if (!next.has(edgeId)) {
				changed.add(edgeId);
			}
		}
		for (const edgeId of next) {
			if (!this.focusedEdgeIds.has(edgeId)) {
				changed.add(edgeId);
			}
		}
		this.focusedEdgeIds = next;
		return {
			focusedEdgeIds: this.focusedEdgeIds,
			changedEdgeIds: changed,
		};
	}

	current(): ReadonlySet<string> {
		return this.focusedEdgeIds;
	}

	reset(): void {
		this.focusedEdgeIds = new Set<string>();
	}

	private edgeIdsForRoom(room: RH.Room | null): Set<string> {
		const result = new Set<string>();
		if (!room) {
			return result;
		}
		for (const boundary of room.boundaryEdges) {
			const structural = RH.structuralEdgeForTilePair(
				boundary.a,
				boundary.b,
				boundary.barrier,
			);
			if (!structural) {
				continue;
			}
			result.add(renderEdgeIdFor(structural));
		}
		return result;
	}
}
