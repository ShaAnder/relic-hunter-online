export interface WorldObjectRegistryEntry {
	readonly id: string;
}

/**
 * Small ownership registry used by renderer subsystems.
 *
 * It intentionally does not know about Pixi, gameplay state, visibility or
 * depth. Its only job is stable ID -> runtime object lookup.
 */
export class WorldObjectRegistry<T extends WorldObjectRegistryEntry> {
	private readonly entries = new Map<string, T>();

	add(entry: T): void {
		if (this.entries.has(entry.id)) {
			throw new Error(`WorldObjectRegistry: duplicate id ${entry.id}`);
		}
		this.entries.set(entry.id, entry);
	}

	get(id: string): T | undefined {
		return this.entries.get(id);
	}

	remove(id: string): T | undefined {
		const entry = this.entries.get(id);
		if (!entry) {
			return undefined;
		}
		this.entries.delete(id);
		return entry;
	}

	values(): IterableIterator<T> {
		return this.entries.values();
	}

	get size(): number {
		return this.entries.size;
	}

	clear(): void {
		this.entries.clear();
	}
}
