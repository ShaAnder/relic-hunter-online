import type { Container } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import type { DoorState } from "@relic-hunter/shared";
import { perf } from "@/perf/PerfMonitor";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type { CompiledFloorVisual } from "../compiler/CompiledFloorVisual";
import { DynamicBarrierRenderer } from "../dynamic/DynamicBarrierRenderer";
import {
	FogPresentationBuffer,
	type FogPresentationSource,
} from "../presentation/FogPresentationBuffer";
import { StaticWorldRenderer } from "../world/StaticWorldRenderer";
import { GroundChunkRenderer } from "./GroundChunkRenderer";

export interface RenderedFloorPresentationInput {
	fog: FogPresentationSource | null;
	focusRoom: RH.Room | null;
	forceWashed?: boolean;
}

export interface RenderedFloorRuntimeStats {
	groundChunkCount: number;
	groundMeshCount: number;
	groundVertexCount: number;
	staticDepthStrata: number;
	staticWorldMeshCount: number;
	staticWorldVertices: number;
	dynamicDoorCount: number;
}

/**
 * Owns the rendered/GPU runtime for exactly one compiled floor variant.
 * This object is the Phase 5 counterpart to CompiledFloorVisual:
 *
 * CompiledFloorVisual
 *     = CPU-side compiled structural description
 *
 * RenderedFloorRuntime
 *     = live Pixi/GPU resources created from that description
 *
 * A runtime can be detached and later reattached without rebuilding.
 */
export class RenderedFloorRuntime {
	private readonly ground: GroundChunkRenderer;
	private readonly world: StaticWorldRenderer;
	private readonly dynamicBarriers: DynamicBarrierRenderer;
	private readonly fog: FogPresentationBuffer;
	private lastFocusRoomId: number | null = null;
	private lastForceWashed = false;
	private attached = true;

	constructor(
		readonly compiled: CompiledFloorVisual,
		private readonly groundRoot: Container,
		private readonly worldDepthRoot: Container,
		readonly renderWorld: boolean,
		private readonly presentationPerfLabel: string,
	) {
		this.ground = new GroundChunkRenderer(this.groundRoot);
		this.world = new StaticWorldRenderer(this.worldDepthRoot);
		this.dynamicBarriers = new DynamicBarrierRenderer(this.worldDepthRoot);
		this.fog = new FogPresentationBuffer(compiled.width, compiled.height);
		this.ground.mount(compiled);
		if (this.renderWorld) {
			this.world.mount(compiled);
			this.dynamicBarriers.mount(compiled.dynamicBarriers);
		}
	}

	matches(compiled: CompiledFloorVisual, renderWorld: boolean): boolean {
		return this.compiled === compiled && this.renderWorld === renderWorld;
	}

	attach(): void {
		if (this.attached) {
			return;
		}
		this.ground.attach();
		if (this.renderWorld) {
			this.world.attach();
			this.dynamicBarriers.attach();
		}
		this.attached = true;
	}

	detach(): void {
		if (!this.attached) {
			return;
		}
		this.dynamicBarriers.detach();
		this.world.detach();
		this.ground.detach();
		this.attached = false;
	}

	updatePresentation(input: RenderedFloorPresentationInput): void {
		const endPerf = perf.start(this.presentationPerfLabel);
		const dirty = new Set<RenderChunkId>(
			this.fog.update(this.compiled, input.fog),
		);

		const forceWashed = input.forceWashed ?? false;
		const nextFocusRoomId = input.focusRoom?.id ?? null;
		const focusChanged = nextFocusRoomId !== this.lastFocusRoomId;
		const washChanged = forceWashed !== this.lastForceWashed;

		if (focusChanged || washChanged) {
			for (const chunkId of this.ground.allChunkIds()) {
				dirty.add(chunkId);
			}
		}

		const focusCellKeys = input.focusRoom
			? new Set(input.focusRoom.cells.map((coord) => RH.coordKey(coord)))
			: null;

		this.ground.updatePresentation(
			dirty,
			this.compiled.width,
			this.fog,
			focusCellKeys,
			forceWashed,
		);

		if (this.renderWorld) {
			this.world.updatePresentation({
				fog: this.fog,
				mapWidth: this.compiled.width,
				focusRoom: input.focusRoom,
				forceWashed,
			});

			this.dynamicBarriers.updatePresentation({
				fog: this.fog,
				mapWidth: this.compiled.width,
				focusRoom: input.focusRoom,
				forceWashed,
			});
		}
		this.lastFocusRoomId = nextFocusRoomId;
		this.lastForceWashed = forceWashed;
		endPerf();
	}

	setDoorState(edgeId: string, state: DoorState): void {
		if (!this.renderWorld) {
			return;
		}
		this.dynamicBarriers.setDoorState(edgeId, state);
	}

	get stats(): RenderedFloorRuntimeStats {
		return {
			groundChunkCount: this.ground.chunkCount,
			groundMeshCount: this.ground.meshCount,
			groundVertexCount: this.ground.vertexCount,
			staticDepthStrata: this.renderWorld ? this.world.depthStrataCount : 0,
			staticWorldMeshCount: this.renderWorld ? this.world.meshCount : 0,
			staticWorldVertices: this.renderWorld ? this.world.vertexCount : 0,
			dynamicDoorCount: this.renderWorld ? this.dynamicBarriers.doorCount : 0,
		};
	}

	destroy(): void {
		this.dynamicBarriers.destroy();
		this.world.destroy();
		this.ground.destroy();
		this.lastFocusRoomId = null;
		this.lastForceWashed = false;
		this.attached = false;
	}
}
