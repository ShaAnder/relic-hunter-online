import { Container } from "pixi.js";
import type { StaticWorldMeshHandle } from "./StaticWorldMeshHandle";
import { depthFromKey, type VisualDepthKey } from "./worldDepthKey";

interface DepthStratum {
	root: Container;
}

/**
 * Owns only the exact static depth strata inserted into the shared world root.
 *
 * Dynamic actors remain direct children of worldDepthRoot. Each exact static
 * stratum is also a direct child so Pixi can interleave dynamic objects between
 * neighboring static depths.
 */
export class WorldDepthStrata {
	private readonly strata = new Map<VisualDepthKey, DepthStratum>();
	private attached = true;

	constructor(private readonly worldDepthRoot: Container) {
		this.worldDepthRoot.sortableChildren = true;
	}

	mount(handle: StaticWorldMeshHandle): void {
		this.stratumFor(handle.depthKey).root.addChild(handle.mesh);
	}

	get stratumCount(): number {
		return this.strata.size;
	}

	allDepthKeys(): readonly VisualDepthKey[] {
		return [...this.strata.keys()].sort((a, b) => a - b);
	}

	/**
	 * Mesh resources are destroyed by StaticWorldRenderer before this runs.
	 * This method owns only the stratum Containers.
	 */
	clear(): void {
		for (const stratum of this.strata.values()) {
			stratum.root.removeChildren();
			stratum.root.removeFromParent();
			stratum.root.destroy();
		}
		this.strata.clear();
		this.attached = true;
	}

	/**
	 * Reattach exact-depth roots directly beneath worldDepthRoot.
	 *
	 * Do not introduce a floor wrapper here: actors, doors and static strata
	 * must remain siblings at the Pixi sorting boundary.
	 */
	attach(): void {
		if (this.attached) {
			return;
		}
		for (const stratum of this.strata.values()) {
			this.worldDepthRoot.addChild(stratum.root);
		}
		this.attached = true;
	}

	/**
	 * Remove static strata from the live scene while preserving their child
	 * Meshes/GPU resources for a later rendered-floor cache hit.
	 */
	detach(): void {
		if (!this.attached) {
			return;
		}
		for (const stratum of this.strata.values()) {
			stratum.root.removeFromParent();
		}
		this.attached = false;
	}
	destroy(): void {
		this.clear();
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
		 * This direct-parent relationship is the painter-order invariant.
		 */
		if (this.attached) {
			this.worldDepthRoot.addChild(root);
		}
		const created: DepthStratum = {
			root,
		};
		this.strata.set(depthKey, created);
		return created;
	}
}
