const STORAGE_PREFIX = "relic-hunter-custom-map:";

/* Persistent boundary for saved custom maps, built with an interface so we can swap in Supabase later, same as CharacterRepo. */
export interface CustomMapRepo {
	save(name: string, blueprint: number[][]): void;
	list(): string[];
	load(name: string): number[][] | null;
	delete(name: string): void;
}

/**
 * Local storage implementation. Each map is its own key
 * (STORAGE_PREFIX + name) rather than one combined array — this is
 * what makes "list every saved map" a simple scan over localStorage's
 * own keys instead of a separately-maintained index that could drift
 * out of sync with what's actually stored.
 */
export class LocalCustomMapRepo implements CustomMapRepo {
	save(name: string, blueprint: number[][]): void {
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

	delete(name: string): void {
		localStorage.removeItem(STORAGE_PREFIX + name);
	}
}
