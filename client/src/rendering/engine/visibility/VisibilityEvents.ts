import type { GridCoord } from "@relic-hunter/shared";

/**
 * Current events list for our visibility that we can use in case we need
 * to recompute later. That way we have a stable tracker tired to each event
 */
export type VisibilityEvent =
	| {
			type: "viewed-floor-changed";
			floorIndex: number;
	  }
	| {
			type: "observer-changed";
			floorIndex: number;
			coord: GridCoord;
	  }
	| {
			type: "fog-changed";
	  }
	| {
			type: "privacy-changed";
	  }
	| {
			type: "structure-changed";
	  }
	| {
			type: "entity-moved";
			entityId: string;
	  }
	| {
			type: "entity-state-changed";
			entityId: string;
	  }
	| {
			type: "entity-spawned";
			entityId: string;
	  }
	| {
			type: "entity-removed";
			entityId: string;
	  };
