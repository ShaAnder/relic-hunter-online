import type * as RH from "@relic-hunter/shared";

import { perf } from "@/perf/PerfMonitor";

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
 *
 * Caches compiled floor geometry across presentation refreshes AND floor
 * switches.
 *
 * The previous implementation kept only the most recently compiled floor.
 * That worked for repeated fog/focus updates on one floor, but cross-floor AI
 * caused the cache to alternate:
 *
 *     floor 1 -> floor 2 -> floor 1 -> floor 0 -> floor 1
 *
 * Every return to an older floor therefore performed another full compile.
 *
 * This cache is keyed first by the actual CompiledEdgeMap source object and
 * then by the structural compiler options that can change generated geometry.
 */
export class EngineCompilerHarness {
	private readonly compiler = new MapVisualCompiler();

	/**
	 * Source identity is the first cache boundary.
	 *
	 * WeakMap is useful here because it does not keep obsolete map objects alive
	 * solely because they were once compiled. If a map is replaced and nothing
	 * else references the old source, normal garbage collection may reclaim it.
	 */
	private cache = new WeakMap<
		RH.CompiledEdgeMap,
		Map<string, CompiledFloorVisual>
	>();

	/**
	 * WeakMap deliberately has no `.size`, so keep a diagnostic count of the
	 * variants inserted into the current cache generation.
	 */
	private cachedVariantCount = 0;

	/**
	 * Compile a floor if this exact structural variant has not been seen before.
	 *
	 * Fog, room focus and other presentation-only state are intentionally not
	 * part of this key because they do not change compiled geometry.
	 */
	compile(
		source: RH.CompiledEdgeMap,

		options: MapVisualCompileOptions,
	): CompiledFloorVisual {
		const wallHeightScale = options.wallHeightScale ?? 1;

		const chunkSize = options.chunkSize ?? DEFAULT_RENDER_CHUNK_SIZE;

		const cacheKey = this.cacheKey(
			options.floorIndex,
			options.mapSeed,
			wallHeightScale,
			chunkSize,
		);

		const sourceCache = this.cache.get(source);

		const cached = sourceCache?.get(cacheKey);

		if (cached) {
			perf.incrementCounter("engine.compilerCacheHits");

			perf.setCounter("engine.compilerCachedVariants", this.cachedVariantCount);

			return cached;
		}

		perf.incrementCounter("engine.compilerCacheMisses");

		/**
		 * Only genuine cache misses reach the expensive compiler.
		 */
		const startedAt = performance.now();

		const result = this.compiler.compile(source, {
			...options,

			wallHeightScale,

			chunkSize,
		});

		const durationMs = performance.now() - startedAt;

		const snapshot = createVisualCompilerSnapshot(result);

		/**
		 * Do not mutate the cache until compilation succeeds. A thrown compile
		 * should never leave a half-valid cache entry behind.
		 */
		let targetCache = sourceCache;

		if (!targetCache) {
			targetCache = new Map<string, CompiledFloorVisual>();

			this.cache.set(source, targetCache);
		}

		targetCache.set(cacheKey, result);

		this.cachedVariantCount += 1;

		perf.setCounter("engine.compilerCachedVariants", this.cachedVariantCount);

		/**
		 * This log intentionally represents REAL compiler work only.
		 *
		 * A healthy cross-floor session should therefore log each stable floor
		 * once after initial compilation rather than every time AI revisits it.
		 */
		console.info("[renderer.compiler]", {
			floorIndex: result.floorIndex,

			durationMs,

			...snapshot,
		});

		return result;
	}

	/**
	 * Throw away every compiled visual associated with the current structural
	 * map generation.
	 *
	 * Map regeneration already calls this method, so replacing the authored
	 * floor sources still gets a clean cache rather than reusing stale geometry.
	 */
	invalidate(): void {
		this.cache = new WeakMap<
			RH.CompiledEdgeMap,
			Map<string, CompiledFloorVisual>
		>();

		this.cachedVariantCount = 0;

		perf.setCounter("engine.compilerCachedVariants", 0);
	}

	/**
	 * Stable identity for every compile option that currently affects geometry.
	 *
	 * If MapVisualCompileOptions gains another structural option later, it must
	 * be represented here as well.
	 */
	private cacheKey(
		floorIndex: number,

		mapSeed: number,

		wallHeightScale: number,

		chunkSize: number,
	): string {
		return JSON.stringify([floorIndex, mapSeed, wallHeightScale, chunkSize]);
	}
}
