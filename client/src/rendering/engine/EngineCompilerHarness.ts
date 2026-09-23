import type * as RH from "@relic-hunter/shared";

import { DEFAULT_RENDER_CHUNK_SIZE } from "./chunks/ChunkCoord";

import type { CompiledFloorVisual } from "./compiler/CompiledFloorVisual";

import {
	MapVisualCompiler,
	type MapVisualCompileOptions,
} from "./compiler/MapVisualCompiler";

import { createVisualCompilerSnapshot } from "./diagnostics/VisualCompilerDiagnostics";

/**
 * EngineCompilerHarness
 * ---------------------
 * This class sits between MapScene and MapVisualCompiler.
 * Its main responsibility is preventing unnecessary full-floor compiles.
 * MapScene may ask for compiled rendering data many times because fog,
 * focus, camera state or other presentation details change.
 * Most of those things do NOT change the underlying map geometry.
 */
export class EngineCompilerHarness {
	// One reusable compiler instance.
	private readonly compiler = new MapVisualCompiler();

	/**
	 * The following fields describe the input that produced our currently
	 * cached CompiledFloorVisual.
	 */
	private cachedSource: RH.CompiledEdgeMap | null = null;
	private cachedFloorIndex: number | null = null;
	private cachedMapSeed: number | null = null;
	private cachedWallHeightScale: number | null = null;
	private cachedChunkSize: number | null = null;

	// The expensive result we want to reuse.
	private cachedResult: CompiledFloorVisual | null = null;

	/**
	 * Compile a floor if necessary, otherwise return the already compiled
	 * result.
	 */
	compile(
		source: RH.CompiledEdgeMap,
		options: MapVisualCompileOptions,
	): CompiledFloorVisual {
		/**
		 * MapVisualCompileOptions makes these two values optional:
		 *
		 * wallHeightScale?: number
		 * chunkSize?: number
		 */
		const wallHeightScale = options.wallHeightScale ?? 1;
		const chunkSize = options.chunkSize ?? DEFAULT_RENDER_CHUNK_SIZE;

		/**
		 * Check whether EVERY meaningful compiler input still matches
		 * the input that produced cachedResult.
		 */
		const cacheMatches =
			this.cachedResult !== null &&
			this.cachedSource === source &&
			this.cachedFloorIndex === options.floorIndex &&
			this.cachedMapSeed === options.mapSeed &&
			this.cachedWallHeightScale === wallHeightScale &&
			this.cachedChunkSize === chunkSize;

		/**
		 * If nothing affecting compiled geometry has changed,
		 * immediately return the old result.
		 */
		if (cacheMatches && this.cachedResult !== null) {
			return this.cachedResult;
		}

		// perform a timed check on the compiler details and create a snapshot
		const startedAt = performance.now();
		const result = this.compiler.compile(source, {
			...options,
			wallHeightScale,
			chunkSize,
		});
		const durationMs = performance.now() - startedAt;
		const snapshot = createVisualCompilerSnapshot(result);

		/**
		 * The compile succeeded, so this input/result combination now
		 * becomes our cache.
		 */
		this.cachedSource = source;
		this.cachedFloorIndex = options.floorIndex;
		this.cachedMapSeed = options.mapSeed;
		this.cachedWallHeightScale = wallHeightScale;
		this.cachedChunkSize = chunkSize;
		this.cachedResult = result;

		/**
		 * Only REAL compiles reach this point.
		 *
		 * Cache hits returned earlier, so normal fog/focus refreshes
		 * should not spam this message.
		 */
		console.info("[renderer.compiler]", {
			floorIndex: result.floorIndex,
			durationMs,
			...snapshot,
		});
		return result;
	}

	/**
	 * Explicitly throw away the cached result.
	 * We use this when the underlying map structure has genuinely changed,
	 * for example when MapScene regenerates the map.
	 * The next call to compile() will therefore perform a real compile.
	 */
	invalidate(): void {
		this.cachedSource = null;
		this.cachedFloorIndex = null;
		this.cachedMapSeed = null;
		this.cachedWallHeightScale = null;
		this.cachedChunkSize = null;
		this.cachedResult = null;
	}
}
