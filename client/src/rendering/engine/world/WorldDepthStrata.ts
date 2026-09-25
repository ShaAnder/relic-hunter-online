import { Container } from "pixi.js";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type { StaticWorldMeshHandle } from "./StaticWorldMeshHandle";
import { depthFromKey, type VisualDepthKey } from "./worldDepthKey";

interface DepthStratum {
	root: Container;

	chunks: Map<RenderChunkId, Container>;
}

/**
 * Owns only the static container hierarchy inserted into the shared world
 * depth root.
 *
 * Dynamic actors remain direct children of the same worldDepthRoot. Each
 * static stratum is also a direct child so Pixi can interleave them correctly.
 */
export class WorldDepthStrata {
	private readonly strata = new Map<VisualDepthKey, DepthStratum>();

	constructor(private readonly worldDepthRoot: Container) {
		this.worldDepthRoot.sortableChildren = true;
	}

	mount(handle: StaticWorldMeshHandle): void {
		const chunkRoot = this.chunkRoot(handle.depthKey, handle.chunkId);
		chunkRoot.addChild(handle.mesh);
	}

	get stratumCount(): number {
		return this.strata.size;
	}

	allDepthKeys(): readonly VisualDepthKey[] {
		return [...this.strata.keys()].sort((a, b) => a - b);
	}

	/**
	 * Remove only containers owned by this static-world hierarchy.
	 *
	 * Mesh resources themselves are destroyed by StaticWorldRenderer before
	 * this method runs.
	 */
	clear(): void {
		for (const stratum of this.strata.values()) {
			for (const chunkRoot of stratum.chunks.values()) {
				chunkRoot.removeChildren();
				chunkRoot.removeFromParent();
				chunkRoot.destroy();
			}
			stratum.root.removeChildren();
			stratum.root.removeFromParent();
			stratum.root.destroy();
		}
		this.strata.clear();
	}
	destroy(): void {
		this.clear();
	}

	private chunkRoot(
		depthKey: VisualDepthKey,
		chunkId: RenderChunkId,
	): Container {
		const stratum = this.stratumFor(depthKey);
		const existing = stratum.chunks.get(chunkId);
		if (existing) {
			return existing;
		}
		const root = new Container();
		root.label = `static-world-chunk:${chunkId}`;
		stratum.root.addChild(root);
		stratum.chunks.set(chunkId, root);
		return root;
	}

	private stratumFor(depthKey: VisualDepthKey): DepthStratum {
		const existing = this.strata.get(depthKey);
		if (existing) {
			return existing;
		}
		const root = new Container();
		root.label = `static-depth:${depthKey}`;
		root.zIndex = depthFromKey(depthKey);

		/**
		 * This direct parent relationship is the important part.
		 *
		 * Actors/chests/monsters are also direct children of worldDepthRoot,
		 * so Pixi can sort an actor between two different static strata.
		 */
		this.worldDepthRoot.addChild(root);
		const created: DepthStratum = {
			root,
			chunks: new Map(),
		};
		this.strata.set(depthKey, created);
		return created;
	}
}
