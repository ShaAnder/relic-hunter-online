import { perf } from "@/perf/PerfMonitor";
import type { VisibilityEvent } from "./VisibilityEvents";
import { VisibilityRevision } from "./VisibilityRevision";

export interface VisibilityRecord {
	readonly id: string;
	evaluate(): boolean;
	apply(visible: boolean): void;
}

/**
 * Event-driven visibility invalidation.
 *
 * Nothing in this class runs from the normal frame loop.
 *
 * Global visibility inputs (observer/fog/viewed floor/privacy/structure)
 * invalidate every registered dynamic entity. A single entity move/state
 * change invalidates only that entity.
 *
 * The class exists to solve one problem: Don't scan every dynamic entity frame
 * Only recheck visibility when something relevant changes and only for entites
 * that may be affected.
 */
export class EntityVisibilitySystem {
	private readonly records = new Map<string, VisibilityRecord>();
	private readonly lastVisible = new Map<string, boolean>();
	private readonly dirtyIds = new Set<string>();
	private allDirty = false;
	private readonly revision = new VisibilityRevision();

	// register the change in vis records + add dirty id
	register(record: VisibilityRecord): void {
		if (this.records.has(record.id)) {
			throw new Error(`EntityVisibilitySystem: duplicate id ${record.id}`);
		}
		this.records.set(record.id, record);
		this.dirtyIds.add(record.id);
	}

	// delete the record
	unregister(entityId: string): void {
		this.records.delete(entityId);
		this.lastVisible.delete(entityId);
		this.dirtyIds.delete(entityId);
	}

	handle(event: VisibilityEvent): void {
		this.revision.bump();

		switch (event.type) {
			case "viewed-floor-changed":
			case "observer-changed":
			case "fog-changed":
			case "privacy-changed":
			case "structure-changed":
				this.allDirty = true;
				break;
			case "entity-moved":
			case "entity-state-changed":
			case "entity-spawned":
				if (this.records.has(event.entityId)) {
					this.dirtyIds.add(event.entityId);
				}
				break;
			case "entity-removed":
				/**
				 * The record should already be gone by the time this event is
				 * emitted, so no evaluation work is necessary.
				 */
				break;
		}
		this.flush();
	}

	flush(): void {
		const ids = this.allDirty ? [...this.records.keys()] : [...this.dirtyIds];
		this.allDirty = false;
		this.dirtyIds.clear();
		if (ids.length === 0) {
			return;
		}
		let checked = 0;

		for (const id of ids) {
			const record = this.records.get(id);
			if (!record) {
				continue;
			}
			checked += 1;
			const nextVisible = record.evaluate();
			const previous = this.lastVisible.get(id);
			if (previous !== nextVisible) {
				record.apply(nextVisible);
				this.lastVisible.set(id, nextVisible);
			}
		}

		perf.incrementCounter("engine.visibilityRecomputes");
		perf.incrementCounter("engine.entitiesVisibilityChecked", checked);
	}

	currentRevision(): number {
		return this.revision.current();
	}

	clear(): void {
		this.records.clear();
		this.lastVisible.clear();
		this.dirtyIds.clear();
		this.allDirty = false;
		this.revision.reset();
	}
}

/*

REGISTER ENTITY
    ↓
records["monster-7"] = VisibilityRecord
dirtyIds.add("monster-7")

EVENT HAPPENS
    ↓
handle(event)
    ↓
revision.bump()

    entity-specific event?
        → dirtyIds.add(entityId)

    global event?
        → allDirty = true

    ↓
flush()

    ↓
choose dirty entities

    ↓
record.evaluate()

    ↓
compare against lastVisible

    ↓
different?
    YES → record.apply(newVisibility)
          remember new visibility

    NO  → do nothing

*/
