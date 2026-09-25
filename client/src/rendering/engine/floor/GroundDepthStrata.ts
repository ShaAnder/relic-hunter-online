import { Container } from "pixi.js";

import type { RenderChunkId } from "../chunks/ChunkCoord";

import type { StaticGroundMeshHandle } from "../gpu/StaticMeshFactory";

import { depthFromKey, type VisualDepthKey } from "../world/worldDepthKey";

interface GroundDepthStratum {
	root: Container;

	chunks: Map<RenderChunkId, Container>;
}

/**
 * Scene-graph owner for ground painter-order strata.
 *
 * Chunking remains useful for lifetime/culling, but chunks must not become the
 * parent level that controls painter order. Exact depth strata are therefore
 * direct children of the shared ground root.
 */
export class GroundDepthStrata {
	private readonly strata = new Map<VisualDepthKey, GroundDepthStratum>();

	constructor(private readonly root: Container) {
		this.root.sortableChildren = true;
	}

	mount(
		depthKey: VisualDepthKey,

		chunkId: RenderChunkId,

		mesh: StaticGroundMeshHandle["mesh"],
	): void {
		this.chunkRoot(depthKey, chunkId).addChild(mesh);
	}

	clear(): void {
		for (const stratum of this.strata.values()) {
			for (const chunk of stratum.chunks.values()) {
				chunk.removeChildren();
				chunk.removeFromParent();
				chunk.destroy();
			}

			stratum.root.removeChildren();
			stratum.root.removeFromParent();
			stratum.root.destroy();
		}

		this.strata.clear();
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

		root.label = `ground-chunk:${chunkId}`;

		stratum.root.addChild(root);

		stratum.chunks.set(chunkId, root);

		return root;
	}

	private stratumFor(depthKey: VisualDepthKey): GroundDepthStratum {
		const existing = this.strata.get(depthKey);

		if (existing) {
			return existing;
		}

		const root = new Container();

		root.label = `ground-depth:${depthKey}`;

		root.zIndex = depthFromKey(depthKey);

		this.root.addChild(root);

		const created: GroundDepthStratum = {
			root,

			chunks: new Map(),
		};

		this.strata.set(depthKey, created);

		return created;
	}
}
