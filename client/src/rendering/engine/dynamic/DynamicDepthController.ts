import type { Container } from "pixi.js";
import { perf } from "@/perf/PerfMonitor";

/**
 * Persistent depth writer for one dynamic display object.
 *
 * Reassigning the same zIndex has no visual value and still dirties sortable
 * state inside the renderer. Remember the last depth and write only when the
 * projected ground contact actually changed.
 *
 * The idea being moving actors need their depth updatated so it can correctly pass
 * in front of / behind walls / other actors. so this checks for zindex updates and
 * changes it accordingly
 */
export class DynamicDepthController {
	private lastDepth: number | null = null;

	update(view: Container, groundY: number, bias = 0): boolean {
		const nextDepth = groundY + bias;
		if (!Number.isFinite(nextDepth)) {
			throw new Error(`DynamicDepthController: non-finite depth ${nextDepth}`);
		}
		if (this.lastDepth === nextDepth) {
			return false;
		}
		this.lastDepth = nextDepth;
		view.zIndex = nextDepth;
		perf.incrementCounter("engine.dynamicDepthWrites");
		return true;
	}

	reset(): void {
		this.lastDepth = null;
	}
}
