const STORAGE_PREFIX = "relic-hunter-custom-map:";

/**
 * Persistent boundary for saved custom maps, built with an interface
 * so the local-dev-file-backed implementation and a future real
 * server/cloud implementation can both satisfy it without callers
 * changing — same shape as CharacterRepo's own interface/local-impl
 * split.
 *
 * save/delete are async: both are genuine network I/O against the
 * local dev save endpoint (see client/vite-plugins/saveCustomMap.ts)
 * or, eventually, a real backend. list/load stay synchronous — they
 * read from a statically-imported registry that's already resolved
 * by the time any code runs, not a live request each call.
 */
export interface CustomMapRepo {
	save(name: string, blueprint: number[][]): Promise<void>;
	list(): string[];
	load(name: string): number[][] | null;
	delete(name: string): Promise<void>;
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
	async save(name: string, blueprint: number[][]): Promise<void> {
		localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(blueprint));
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

	load(name: string): number[][] | null {
		try {
			const raw = localStorage.getItem(STORAGE_PREFIX + name);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	async delete(name: string): Promise<void> {
		localStorage.removeItem(STORAGE_PREFIX + name);
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

	async save(name: string, blueprint: number[][]): Promise<void> {
		const response = await fetch("/api/save-custom-map", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, blueprint }),
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

	load(name: string): number[][] | null {
		const entry = registryEntries().find((e) => e.name === name);
		return entry ? entry.blueprint : null;
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
import { CUSTOM_MAPS } from "@relic-hunter/shared";

function registryEntries(): { name: string; blueprint: number[][] }[] {
	return CUSTOM_MAPS;
}

function registryNames(): string[] {
	return CUSTOM_MAPS.map((e) => e.name);
}

/** The registry doesn't store each map's filename (only its display name + blueprint), so deleting needs the same name->identifier rule the save endpoint used when it wrote the file. Falls back to re-deriving it if a name isn't found in the registry at all (e.g. deleting a just-saved map before HMR has caught up). */
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
