import type { Container } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import { perf } from "@/perf/PerfMonitor";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type { CompiledFloorVisual } from "../compiler/CompiledFloorVisual";
import {
	FogPresentationBuffer,
	type FogPresentationSource,
} from "../presentation/FogPresentationBuffer";
import { StaticWorldRenderer } from "../world/StaticWorldRenderer";
import { GroundChunkRenderer } from "./GroundChunkRenderer";

export interface FloorPresentationInput {
	fog: FogPresentationSource | null;
	focusRoom: RH.Room | null;
	forceWashed?: boolean;
}

/**
 * Runtime coordinator for one compiled floor.
 *
 * Ground and static world consume the same immutable CompiledFloorVisual.
 * Fog/focus state lives separately and patches presentation/GPU buffers rather
 * than rebuilding structural geometry.
 */
export class FloorRenderer {
	private readonly ground: GroundChunkRenderer;
	private readonly world: StaticWorldRenderer;
	private compiled: CompiledFloorVisual | null = null;
	private fog: FogPresentationBuffer | null = null;
	private lastFocusRoomId: number | null = null;
	private lastForceWashed = false;

	constructor(groundRoot: Container, worldDepthRoot: Container) {
		this.ground = new GroundChunkRenderer(groundRoot);
		this.world = new StaticWorldRenderer(worldDepthRoot);
	}

	mount(compiled: CompiledFloorVisual): void {
		/**
		 * CompiledFloorVisual is treated as an immutable floor snapshot.
		 * Reference identity therefore means these GPU resources are already
		 * mounted for this exact compiled structure.
		 */
		if (this.compiled === compiled) {
			return;
		}

		this.ground.mount(compiled);
		this.world.mount(compiled);
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

		/**
		 * Start with chunks whose fog values changed, then augment that set for
		 * global presentation changes such as room focus / forced wash.
		 */
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

		/**
		 * StaticWorldRenderer owns world-surface presentation and focus buffer
		 * patches. FloorRenderer only supplies the already-resolved state.
		 */
		this.world.updatePresentation({
			fog: this.fog,
			mapWidth: this.compiled.width,
			focusRoom: input.focusRoom,
			forceWashed,
		});
		this.lastFocusRoomId = nextFocusRoomId;
		this.lastForceWashed = forceWashed;
		perf.setCounter("engine.fogDirtyChunks", dirty.size);
		endPerf();
	}

	destroy(): void {
		this.world.destroy();
		this.ground.destroy();
		this.compiled = null;
		this.fog = null;
		this.lastFocusRoomId = null;
		this.lastForceWashed = false;
	}
}
