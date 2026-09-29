import type { Container } from "pixi.js";
import type { GridCoord } from "@relic-hunter/shared";
import { perf } from "@/perf/PerfMonitor";
import { WorldObjectRegistry } from "../objects/WorldObjectRegistry";
import { EntityVisibilitySystem } from "../visibility/EntityVisibilitySystem";
import type { VisibilityEvent } from "../visibility/VisibilityEvents";
import {
	DynamicWorldHandle,
	type DynamicWorldHandleOptions,
	type DynamicWorldSubject,
} from "./DynamicWorldHandle";

// just says hey give me an entity snapshot, i tell you t/f
export type DynamicVisibilityResolver = (
	subject: DynamicWorldSubject,
) => boolean;

/**
 * Runtime registration/visibility seam for hunters, monsters, chests and future
 * stateful props.
 *
 * It does not own gameplay state or entity destruction. Entity systems still
 * own their objects; this renderer owns scene attachment + visibility updates.
 */
export class DynamicWorldRenderer {
	// currently existing dynamic handlers
	private readonly registry = new WorldObjectRegistry<DynamicWorldHandle>();
	// which of those need objects checking
	private readonly visibility = new EntityVisibilitySystem();
	// renderers currently selected floor
	private viewedFloor = 0;
	private readonly visibilityOverrides = new Map<string, boolean>();

	constructor(
		// pixi parent
		private readonly root: Container,
		// function that knows our visibility rules
		private readonly resolveVisibility: DynamicVisibilityResolver,
	) {
		// tells us that yse the stuff is sortable
		this.root.sortableChildren = true;
	}

	register(options: DynamicWorldHandleOptions): DynamicWorldHandle {
		const handle = new DynamicWorldHandle(options);
		this.registry.add(handle);
		/**
		 * Hide until the first visibility evaluation to avoid a one-frame flash
		 * for an entity that spawns outside the observer's current visibility.
		 */
		handle.view.visible = false;
		this.root.addChild(handle.view);
		this.visibility.register({
			id: handle.id,
			evaluate: () => {
				const override = this.visibilityOverrides.get(handle.id);
				return override ?? this.resolveVisibility(handle.snapshot());
			},
			apply: (visible) => {
				handle.view.visible = visible;
			},
		});
		this.applyEvent({
			type: "entity-spawned",
			entityId: handle.id,
		});
		return handle;
	}

	unregister(entityId: string): void {
		this.visibilityOverrides.delete(entityId);
		this.visibility.unregister(entityId);
		const handle = this.registry.remove(entityId);
		handle?.view.removeFromParent();
		this.applyEvent({
			type: "entity-removed",
			entityId,
		});
	}

	setViewedFloor(floorIndex: number): void {
		if (this.viewedFloor === floorIndex) return;
		this.viewedFloor = floorIndex;
		this.applyEvent({ type: "viewed-floor-changed", floorIndex });
	}

	observerChanged(floorIndex: number, coord: GridCoord): void {
		this.applyEvent({
			type: "observer-changed",
			floorIndex,
			coord: {
				...coord,
			},
		});
	}

	fogChanged(): void {
		this.applyEvent({
			type: "fog-changed",
		});
	}

	privacyChanged(): void {
		this.applyEvent({
			type: "privacy-changed",
		});
	}

	structureChanged(): void {
		this.applyEvent({
			type: "structure-changed",
		});
	}

	notifyEntityMoved(entityId: string): void {
		this.applyEvent({
			type: "entity-moved",
			entityId,
		});
	}

	notifyEntityStateChanged(entityId: string): void {
		this.applyEvent({
			type: "entity-state-changed",
			entityId,
		});
	}
	/**
	 * Temporary presentation override for scripted reveals/cinematics.
	 * null restores ordinary gameplay visibility immediately.
	 */
	setVisibilityOverride(entityId: string, visible: boolean | null): void {
		if (!this.registry.get(entityId)) {
			return;
		}
		if (visible === null) {
			this.visibilityOverrides.delete(entityId);
		} else {
			this.visibilityOverrides.set(entityId, visible);
		}

		this.notifyEntityStateChanged(entityId);
	}

	clear(): void {
		this.visibility.clear();
		this.visibilityOverrides.clear();
		for (const handle of this.registry.values()) {
			handle.view.removeFromParent();
		}
		this.registry.clear();
		perf.setCounter("engine.dynamicObjectCount", 0);
	}

	private applyEvent(event: VisibilityEvent): void {
		this.visibility.handle(event);
		perf.setCounter("engine.dynamicObjectCount", this.registry.size);
	}
}
