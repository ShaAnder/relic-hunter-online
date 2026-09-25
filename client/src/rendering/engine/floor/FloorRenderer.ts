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

export interface FloorMountOptions {
	renderWorld: boolean;
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
	private worldMounted = false;

	constructor(groundRoot: Container, worldDepthRoot: Container) {
		this.ground = new GroundChunkRenderer(groundRoot);
		this.world = new StaticWorldRenderer(worldDepthRoot);
	}

	mount(compiled: CompiledFloorVisual, options: FloorMountOptions): void {
		const compiledChanged = this.compiled !== compiled;

		if (!compiledChanged) {
			if (options.renderWorld && !this.worldMounted) {
				this.world.mount(compiled);
				this.worldMounted = true;
			} else if (!options.renderWorld && this.worldMounted) {
				this.world.destroy();
				this.worldMounted = false;
			}

			return;
		}
		this.ground.mount(compiled);

		if (options.renderWorld) {
			this.world.mount(compiled);
			this.worldMounted = true;
		} else {
			this.world.destroy();
			this.worldMounted = false;
		}

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
		if (this.worldMounted) {
			this.world.updatePresentation({
				fog: this.fog,
				mapWidth: this.compiled.width,
				focusRoom: input.focusRoom,
				forceWashed,
			});
		}
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
		this.worldMounted = false;
	}
}
