import type { Container } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import type { DoorState } from "@relic-hunter/shared";
import { perf } from "@/perf/PerfMonitor";
import type { CompiledDynamicBarrierAnchor } from "../compiler/CompiledFloorVisual";
import type { FogPresentationBuffer } from "../presentation/FogPresentationBuffer";
import { resolveBarrierPresentation } from "../presentation/WorldPresentation";
import { BarrierFocusBuffer } from "../world/BarrierFocusBuffer";
import { DoorView } from "./DoorView";

export interface DynamicBarrierPresentationInput {
	fog: FogPresentationBuffer;
	mapWidth: number;
	focusRoom: RH.Room | null;
	forceWashed: boolean;
}

/**
 * Owns stateful barrier views that must stay outside static GPU batches.
 *
 * Phase 4 starts with Door. Future destructible/animated barriers can enter
 * through the same seam without changing StaticWorldRenderer<s contract.
 */
export class DynamicBarrierRenderer {
	private readonly doors = new Map<
		string,
		{
			anchor: CompiledDynamicBarrierAnchor;
			view: DoorView;
		}
	>();
	private readonly focus = new BarrierFocusBuffer();

	constructor(private readonly worldDepthRoot: Container) {
		this.worldDepthRoot.sortableChildren = true;
	}

	mount(anchors: readonly CompiledDynamicBarrierAnchor[]): void {
		this.destroy();

		for (const anchor of anchors) {
			const view = new DoorView(anchor);
			this.doors.set(anchor.edgeId, {
				anchor,
				view,
			});
			this.worldDepthRoot.addChild(view.view);
		}
		perf.setCounter("engine.dynamicDoorCount", this.doors.size);
	}

	updatePresentation(input: DynamicBarrierPresentationInput): void {
		const focusDiff = this.focus.update(input.focusRoom);
		for (const { anchor, view } of this.doors.values()) {
			const focused = focusDiff.focusedEdgeIds.has(anchor.edgeId);
			const presentation = resolveBarrierPresentation(
				anchor.visibilityCoords,
				input.mapWidth,
				input.fog,
				input.focusRoom !== null,
				focused,
				input.forceWashed,
			);
			view.applyPresentation(presentation, focused);
		}
	}

	setDoorState(edgeId: string, state: DoorState): void {
		const door = this.doors.get(edgeId);
		if (!door) {
			return;
		}
		if (door.view.setState(state)) {
			perf.incrementCounter("engine.doorUpdates");
		}
	}

	/**
	 * Restore cached DoorViews to the active sortable world root.
	 */
	attach(): void {
		for (const { view } of this.doors.values()) {
			if (view.view.parent === this.worldDepthRoot) {
				continue;
			}
			view.view.removeFromParent();
			this.worldDepthRoot.addChild(view.view);
		}
	}

	/**
	 * Hide this entire cached floor structurally by detaching its DoorViews.
	 * Door state and presentation state remain alive.
	 */
	detach(): void {
		for (const { view } of this.doors.values()) {
			view.view.removeFromParent();
		}
	}

	get doorCount(): number {
		return this.doors.size;
	}

	destroy(): void {
		for (const { view } of this.doors.values()) {
			view.destroy();
		}
		this.doors.clear();
		this.focus.reset();
		perf.setCounter("engine.dynamicDoorCount", 0);
	}
}
