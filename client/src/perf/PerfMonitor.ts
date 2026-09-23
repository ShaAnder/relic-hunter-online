export interface PerfStatSnapshot {
	label: string;
	count: number;
	totalMs: number;
	averageMs: number;
	maxMs: number;
	lastMs: number;
}

interface MutablePerfStat {
	count: number;
	totalMs: number;
	maxMs: number;
	lastMs: number;
}

/**
 * Lightweight browser-side instrumentation.
 *
 * Enable automatically in Vite dev mode.
 * For a production preview, append ?perf=1 to the URL.
 */
export class PerfMonitor {
	private stats = new Map<string, MutablePerfStat>();

	private counters = new Map<string, number>();

	private frameStartedAt = 0;

	enabled =
		import.meta.env.DEV ||
		(typeof window !== "undefined" &&
			new URLSearchParams(window.location.search).has("perf"));

	measure<T>(label: string, fn: () => T): T {
		if (!this.enabled) {
			return fn();
		}

		const startedAt = performance.now();

		try {
			return fn();
		} finally {
			this.record(label, performance.now() - startedAt);
		}
	}

	start(label: string): () => void {
		if (!this.enabled) {
			return () => {};
		}

		const startedAt = performance.now();

		let ended = false;

		return () => {
			if (ended) {
				return;
			}

			ended = true;

			this.record(label, performance.now() - startedAt);
		};
	}

	beginFrame(): void {
		if (!this.enabled) {
			return;
		}

		this.frameStartedAt = performance.now();
	}

	endFrame(): void {
		if (!this.enabled || this.frameStartedAt <= 0) {
			return;
		}

		this.record("frame", performance.now() - this.frameStartedAt);

		this.frameStartedAt = 0;
	}

	setCounter(label: string, value: number): void {
		if (!this.enabled) {
			return;
		}

		this.counters.set(label, value);
	}

	incrementCounter(label: string, amount = 1): void {
		if (!this.enabled) {
			return;
		}

		this.counters.set(label, (this.counters.get(label) ?? 0) + amount);
	}

	snapshot(): {
		stats: PerfStatSnapshot[];
		counters: Record<string, number>;
	} {
		const stats = [...this.stats.entries()]
			.map(
				([label, stat]): PerfStatSnapshot => ({
					label,
					count: stat.count,
					totalMs: stat.totalMs,
					averageMs: stat.count > 0 ? stat.totalMs / stat.count : 0,
					maxMs: stat.maxMs,
					lastMs: stat.lastMs,
				}),
			)
			.sort((a, b) => b.totalMs - a.totalMs);

		return {
			stats,
			counters: Object.fromEntries(this.counters.entries()),
		};
	}

	logSnapshot(): void {
		if (!this.enabled) {
			console.log("[perf] disabled");

			return;
		}

		const snapshot = this.snapshot();

		console.table(
			snapshot.stats.map((stat) => ({
				label: stat.label,
				count: stat.count,
				lastMs: stat.lastMs.toFixed(2),
				avgMs: stat.averageMs.toFixed(2),
				maxMs: stat.maxMs.toFixed(2),
				totalMs: stat.totalMs.toFixed(2),
			})),
		);

		console.table(snapshot.counters);
	}

	reset(): void {
		this.stats.clear();
		this.counters.clear();
		this.frameStartedAt = 0;
	}

	private record(label: string, elapsedMs: number): void {
		const stat = this.stats.get(label) ?? {
			count: 0,
			totalMs: 0,
			maxMs: 0,
			lastMs: 0,
		};

		stat.count += 1;

		stat.totalMs += elapsedMs;

		stat.maxMs = Math.max(stat.maxMs, elapsedMs);

		stat.lastMs = elapsedMs;

		this.stats.set(label, stat);
	}
}

export const perf = new PerfMonitor();

declare global {
	interface Window {
		__RH_PERF__?: PerfMonitor;
	}
}

if (typeof window !== "undefined") {
	window.__RH_PERF__ = perf;
}
