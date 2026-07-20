import type { CharacterData } from "@relic-hunter/shared";

const STORAGE_KEY = "relic-hunter-characters";

/* Persistent boundary for saved mercs, build with interface so we can swap in supabase later */
export interface CharacterRepo {
	save(character: CharacterData): void;
	loadAll(): CharacterData[];
	delete(id: string): void;
}

/**
 * Local storage implementation for current saving / loading
 */
export class LocalCharacterRepo implements CharacterRepo {
	save(character: CharacterData): void {
		const all = this.loadAll();
		const idx = all.findIndex((c) => c.id === character.id);
		if (idx >= 0) {
			all[idx] = character;
		} else {
			all.push(character);
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
	}

	loadAll(): CharacterData[] {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	delete(id: string): void {
		const remaining = this.loadAll().filter((c) => c.id !== id);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
	}
}
