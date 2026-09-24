import type { Container } from "pixi.js";
import type * as RH from "@relic-hunter/shared";
import { perf } from "@/perf/PerfMonitor";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type { CompiledFloorVisual } from "../compiler/CompiledFloorVisual";
import {
	FogPresentationBuffer,
	type FogPresentationSource,
} from "../presentation/FogPresentationBuffer";
import { GroundChunkRenderer } from "./GroundChunkRenderer";

/**
 * Dynamic game-state inputs that can change how an already-mounted floor is presented.
 * These values affect fog/room-focus appearance without requiring the static
 * ground geometry itself to be rebuilt.
 */
export interface FloorPresentationInput {
	fog: FogPresentationSource | null;
	focusRoom: RH.Room | null;
	forceWashed?: boolean;
}

/**
 * Top-level runtime coordinator for the compiled floor renderer.
 * It owns the chunked ground renderer and presentation state, mounts compiled
 * floor geometry, and propagates fog/room-focus changes without rebuilding
 * static geometry. Future floor rendering passes can extend this same boundary.
 */
export class FloorRenderer {
	private readonly ground: GroundChunkRenderer;
	private compiled: CompiledFloorVisual | null = null;
	private fog: FogPresentationBuffer | null = null;
	private lastFocusRoomId: number | null = null;
	private lastForceWashed = false;

	// construct the ground subsystem against the scene container reserved for floor geometry
	constructor(groundRoot: Container) {
		this.ground = new GroundChunkRenderer(groundRoot);
	}
	mount(compiled: CompiledFloorVisual): void {
		if (this.compiled === compiled) {
			return;
		}

		this.ground.mount(compiled);
		this.compiled = compiled;
		this.fog = new FogPresentationBuffer(compiled.width, compiled.height);
		this.lastFocusRoomId = null;
		this.lastForceWashed = false;
	}

	updatePresentation(input: FloorPresentationInput): void {
		if (!this.compiled || !this.fog) {
			return;
		}

		const endPerf = perf.start("engine.fogUpdateMs");
		const dirty = new Set<RenderChunkId>(
			this.fog.update(this.compiled, input.fog),
		);

		const forceWashed = input.forceWashed ?? false;
		const nextFocusRoomId = input.focusRoom?.id ?? null;
		const focusChanged = nextFocusRoomId !== this.lastFocusRoomId;
		const washChanged = forceWashed !== this.lastForceWashed;

		/**
		 * Fog tells us exactly which chunks changed. Room-focus and forced-wash
		 * changes can affect tiles anywhere on the floor, so Phase 2 safely marks
		 * all ground chunks dirty. Only presentation buffers are updated; static
		 * geometry is not rebuilt.
		 */
		if (focusChanged || washChanged) {
			for (const chunkId of this.ground.allChunkIds()) {
				dirty.add(chunkId);
			}
		}

		const focusCellKeys = input.focusRoom
			? new Set(input.focusRoom.cells.map((coord) => `${coord.x},${coord.y}`))
			: null;

		this.ground.updatePresentation(
			dirty,
			this.compiled.width,
			this.fog,
			focusCellKeys,
			forceWashed,
		);
		// Cache this update's global state so the next call can cheaply detect transitions.
		this.lastFocusRoomId = nextFocusRoomId;
		this.lastForceWashed = forceWashed;
		perf.setCounter("engine.fogDirtyChunks", dirty.size);
		endPerf();
	}

	/**
	 * Release the active floor's rendering resources and clear all cached runtime
	 * and presentation state.
	 */
	destroy(): void {
		this.ground.destroy();
		this.compiled = null;
		this.fog = null;
		this.lastFocusRoomId = null;
		this.lastForceWashed = false;
	}
}
