import type { Container } from "pixi.js";
import type * as RH from "@relic-hunter/shared";
import type { DoorState } from "@relic-hunter/shared";
import { perf } from "@/perf/PerfMonitor";
import type { CompiledFloorVisual } from "../compiler/CompiledFloorVisual";
import type { FogPresentationSource } from "../presentation/FogPresentationBuffer";
import {
	RenderedFloorRuntime,
	type RenderedFloorRuntimeStats,
} from "./RenderedFloorRuntime";

export interface FloorPresentationInput {
	fog: FogPresentationSource | null;
	focusRoom: RH.Room | null;
	forceWashed?: boolean;
}

export interface FloorMountOptions {
	renderWorld: boolean;
}

export type FloorRendererRole = "active" | "underlay";

/**
 * Cache/orchestration layer for rendered floor runtimes.
 *
 * A compiler cache hit saves geometry compilation.
 * A FloorRenderer cache hit saves Pixi/GPU resource reconstruction.
 */
export class FloorRenderer {
	private readonly cache = new Map<number, RenderedFloorRuntime>();
	private active: RenderedFloorRuntime | null = null;

	constructor(
		private readonly groundRoot: Container,
		private readonly worldDepthRoot: Container,
		private readonly role: FloorRendererRole = "active",
	) {}

	mount(compiled: CompiledFloorVisual, options: FloorMountOptions): void {
		if (this.active?.matches(compiled, options.renderWorld)) {
			/**
			 * MapScene calls mount() during ordinary presentation refreshes.
			 * Same active runtime means there is no floor activation work.
			 *
			 * Republish counters because the underlay renderer may have touched
			 * shared legacy-era diagnostics earlier in the same scene refresh.
			 */
			this.publishMetrics();

			return;
		}

		const endActivation = perf.start(this.metric("ActivationMs"));
		this.active?.detach();
		let runtime = this.cache.get(compiled.floorIndex);

		if (runtime && !runtime.matches(compiled, options.renderWorld)) {
			/**
			 * Same logical floor, new structural compiled object.
			 *
			 * Do not retain stale GPU resources after compiler invalidation or
			 * structural map replacement.
			 */
			runtime.destroy();
			this.cache.delete(compiled.floorIndex);
			runtime = undefined;
		}

		if (runtime) {
			perf.incrementCounter(this.metric("CacheHits"));
			runtime.attach();
		} else {
			perf.incrementCounter(this.metric("CacheMisses"));
			const endBuild = perf.start(this.metric("BuildMs"));
			runtime = new RenderedFloorRuntime(
				compiled,
				this.groundRoot,
				this.worldDepthRoot,
				options.renderWorld,
				this.presentationMetric(),
			);
			endBuild();
			this.cache.set(compiled.floorIndex, runtime);
		}
		this.active = runtime;
		this.publishMetrics();
		endActivation();
	}

	/**
	 * Detach the currently displayed runtime but retain every cached floor.
	 *
	 * The underlay renderer uses this when the viewed floor has no lower floor.
	 */
	deactivate(): void {
		if (!this.active) {
			return;
		}

		this.active.detach();
		this.active = null;
		this.publishMetrics();
	}

	updatePresentation(input: FloorPresentationInput): void {
		this.active?.updatePresentation(input);
	}

	setDoorState(edgeId: string, state: DoorState): void {
		this.active?.setDoorState(edgeId, state);
	}

	/**
	 * Structural invalidation must clear both CPU compile caches and these
	 * rendered/GPU caches.
	 */
	clearCache(): void {
		this.deactivate();
		for (const runtime of this.cache.values()) {
			runtime.destroy();
		}
		this.cache.clear();
		this.publishMetrics();
	}

	destroy(): void {
		this.clearCache();
	}

	private publishMetrics(): void {
		perf.setCounter(this.metric("CachedFloors"), this.cache.size);

		const stats: RenderedFloorRuntimeStats = this.active?.stats ?? {
			groundChunkCount: 0,
			groundMeshCount: 0,
			groundVertexCount: 0,
			staticDepthStrata: 0,
			staticWorldMeshCount: 0,
			staticWorldVertices: 0,
			dynamicDoorCount: 0,
		};

		if (this.role === "active") {
			perf.setCounter("engine.groundChunkCount", stats.groundChunkCount);
			perf.setCounter("engine.groundMeshCount", stats.groundMeshCount);
			perf.setCounter("engine.groundVertexCount", stats.groundVertexCount);
			perf.setCounter("engine.staticDepthStrata", stats.staticDepthStrata);
			perf.setCounter(
				"engine.staticWorldMeshCount",
				stats.staticWorldMeshCount,
			);
			perf.setCounter("engine.staticWorldVertices", stats.staticWorldVertices);
			perf.setCounter("engine.dynamicDoorCount", stats.dynamicDoorCount);
			perf.setCounter("engine.staticMaskCount", 0);

			return;
		}

		perf.setCounter("engine.underlayGroundMeshCount", stats.groundMeshCount);
		perf.setCounter(
			"engine.underlayStaticWorldMeshCount",
			stats.staticWorldMeshCount,
		);
		perf.setCounter("engine.underlayDynamicDoorCount", stats.dynamicDoorCount);
	}

	private metric(suffix: string): string {
		return this.role === "active"
			? `engine.renderedFloor${suffix}`
			: `engine.underlayFloor${suffix}`;
	}

	private presentationMetric(): string {
		return this.role === "active"
			? "engine.fogUpdateMs"
			: "engine.underlayPresentationMs";
	}
}
