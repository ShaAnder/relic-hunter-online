import type { MapBundle } from "@relic-hunter/shared";
import { CUSTOM_MAPS } from "@relic-hunter/shared";

const STORAGE_PREFIX = "relic-hunter-custom-map:";

/**
 * Persistent boundary for saved custom maps, built with an interface
 * so the local-dev-file-backed implementation and a future real
 * server/cloud implementation can both satisfy it without callers
 * changing — same shape as CharacterRepo's own interface/local-impl
 * split.
 *
 * A saved map is a full MapBundle now (every floor, plus which one is
 * ground) rather than a single floor's blueprint — this is the
 * wiring the multi-floor map data model was always meant to plug
 * into; see mapBundle.ts in the shared package.
 *
 * save/delete are async: both are genuine network I/O against the
 * local dev save endpoint (see client/vite-plugins/saveCustomMap.ts)
 * or, eventually, a real backend. list/load stay synchronous — they
 * read from a statically-imported registry that's already resolved
 * by the time any code runs, not a live request each call.
 */
export interface CustomMapRepo {
	save(name: string, bundle: MapBundle): Promise<void>;
	list(): string[];
	load(name: string): MapBundle | null;
	delete(name: string): Promise<void>;
}

/** True only for something that could plausibly be a MapBundle — used to reject corrupted/foreign localStorage content rather than handing it to the rest of the app and failing somewhere less obvious. Doesn't check each floor's actual dimensions; callers that care about exact shape (Map Creator's own load) still do that themselves. */
function looksLikeMapBundle(value: unknown): value is MapBundle {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.name === "string" &&
		Array.isArray(candidate.floors) &&
		candidate.floors.length > 0 &&
		typeof candidate.groundFloorIndex === "number"
	);
}

/**
 * Local storage implementation — a convenience cache, not a source of
 * truth (see the project's EdgeGrid planning doc: "localStorage is
 * acceptable only as a convenience cache, never as the only place a
 * map lives"). Each map is its own key (STORAGE_PREFIX + name) so
 * "list every saved map" is a simple scan over localStorage's own
 * keys, not a separately-maintained index that could drift out of
 * sync with what's actually stored. Kept around as a fallback for
 * contexts without the local dev save endpoint (e.g. a production
 * build with no filesystem to write to).
 */
export class LocalCustomMapRepo implements CustomMapRepo {
	async save(name: string, bundle: MapBundle): Promise<void> {
		localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(bundle));
	}

	list(): string[] {
		const names: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(STORAGE_PREFIX)) {
				names.push(key.slice(STORAGE_PREFIX.length));
			}
		}
		return names.sort();
	}

	load(name: string): MapBundle | null {
		try {
			const raw = localStorage.getItem(STORAGE_PREFIX + name);
			if (!raw) return null;
			const parsed: unknown = JSON.parse(raw);
			return looksLikeMapBundle(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	async delete(name: string): Promise<void> {
		localStorage.removeItem(STORAGE_PREFIX + name);
	}
}

export class DualWriteCustomMapRepo implements CustomMapRepo {
	constructor(
		private primary: CustomMapRepo, // DevFileCustomMapRepo in dev
		private cache: CustomMapRepo, // LocalCustomMapRepo
	) {}

	async save(name: string, bundle: MapBundle): Promise<void> {
		// Always write the offline browser copy first so offline play
		// never depends on the file write succeeding.
		await this.cache.save(name, bundle);

		// Then the real file (dev) / future cloud write.
		// If this fails we still have the localStorage copy.
		try {
			await this.primary.save(name, bundle);
		} catch (err) {
			// Re-throw so the UI can still show "file save failed"
			// but the offline copy is already safe.
			throw err;
		}
	}

	list(): string[] {
		// Prefer the union of both so a just-saved map appears even
		// before HMR / registry refresh.
		const a = this.primary.list();
		const b = this.cache.list();
		return [...new Set([...a, ...b])].sort();
	}

	load(name: string): MapBundle | null {
		// Prefer the primary (file/registry), fall back to localStorage.
		return this.primary.load(name) ?? this.cache.load(name);
	}

	async delete(name: string): Promise<void> {
		await this.cache.delete(name);
		try {
			await this.primary.delete(name);
		} catch (err) {
			throw err;
		}
	}
}

/**
 * Local-dev-server-backed implementation: save/delete POST/DELETE to
 * the Vite dev server's own save-custom-map middleware, which writes
 * (or removes) a real file under shared/src/world/maps/custom/ and
 * regenerates that folder's registry — see
 * client/vite-plugins/saveCustomMap.ts. The browser itself never
 * touches the filesystem; it can't, that's a sandboxing boundary, not
 * a missing feature. This is what actually performs the write, as a
 * Node process, not the page.
 *
 * list/load read from the statically-imported registry
 * (shared/src/world/maps/custom/index.ts), which Vite hot-reloads
 * when the file changes on disk — but since that reload isn't
 * guaranteed to have landed by the moment save() resolves, every
 * successfully-saved name is also tracked in-memory for this session,
 * so a just-saved map always shows up immediately regardless of HMR
 * timing, while anything saved in an earlier session still comes
 * through the registry import once the page has loaded.
 */
export class DevFileCustomMapRepo implements CustomMapRepo {
	private sessionKnownNames = new Set<string>();

	async save(name: string, bundle: MapBundle): Promise<void> {
		const response = await fetch("/api/save-custom-map", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name,
				floors: bundle.floors,
				groundFloorIndex: bundle.groundFloorIndex,
			}),
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Failed to save map "${name}": ${body}`);
		}
		this.sessionKnownNames.add(name);
	}

	list(): string[] {
		// Imported lazily inside the method (rather than at module top
		// level) so this file doesn't need a hard compile-time
		// dependency on the registry existing with a particular shape
		// before the first map has ever been saved — require() would
		// break tree-shaking here, so this uses a plain synchronous
		// re-export pattern instead: see registryNames() below.
		const fromRegistry = registryNames();
		const merged = new Set([...fromRegistry, ...this.sessionKnownNames]);
		return [...merged].sort();
	}

	load(name: string): MapBundle | null {
		const entry = registryEntries().find((e) => e.name === name);
		if (!entry) return null;
		return {
			name: entry.name,
			floors: entry.floors,
			groundFloorIndex: entry.groundFloorIndex,
		};
	}

	async delete(name: string): Promise<void> {
		const entry = registryEntries().find((e) => e.name === name);
		const safeId = entry ? findSafeIdForName(name) : toGuessedSafeId(name);
		const response = await fetch(
			`/api/delete-custom-map/${encodeURIComponent(safeId)}`,
			{ method: "DELETE" },
		);
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Failed to delete map "${name}": ${body}`);
		}
		this.sessionKnownNames.delete(name);
	}
}

// ---- registry access helpers ----
// Kept as plain functions (not methods) since they wrap a single,
// eagerly-evaluated static import — see the comment on DevFileCustomMapRepo.list().

function registryEntries(): {
	name: string;
	floors: number[][][];
	groundFloorIndex: number;
}[] {
	return CUSTOM_MAPS;
}

function registryNames(): string[] {
	return CUSTOM_MAPS.map((e) => e.name);
}

/** The registry doesn't store each map's filename (only its display name + floor data), so deleting needs the same name->identifier rule the save endpoint used when it wrote the file. Falls back to re-deriving it if a name isn't found in the registry at all (e.g. deleting a just-saved map before HMR has caught up). */
function findSafeIdForName(name: string): string {
	return toGuessedSafeId(name);
}

function toGuessedSafeId(name: string): string {
	const cleaned = name
		.trim()
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	const withLeadingLetter = /^[0-9]/.test(cleaned) ? `Map_${cleaned}` : cleaned;
	return withLeadingLetter || "UnnamedMap";
}
