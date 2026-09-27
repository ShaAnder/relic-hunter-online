import type { Container } from "pixi.js";
import type { GridCoord } from "@relic-hunter/shared";
import type {
	WorldObjectLifetime,
	WorldObjectRenderKind,
} from "../objects/WorldObjectTypes";

export type DynamicWorldKind = "local-hunter" | "hunter" | "monster" | "chest";

export interface DynamicWorldSubject {
	readonly id: string;
	readonly kind: DynamicWorldKind;
	readonly floorIndex: number;
	readonly coord: GridCoord;
	readonly renderKind: WorldObjectRenderKind;
	readonly lifetime: WorldObjectLifetime;
}

/*
This represents a snapshot of the object right now eg:

monster-7
kind       = monster
floor      = 1
coord      = {x: 12, y: 8}
renderKind = sprite
lifetime   = stateful
*/
export interface DynamicWorldHandleOptions {
	id: string;
	kind: DynamicWorldKind;
	view: Container;
	renderKind: WorldObjectRenderKind;
	lifetime: WorldObjectLifetime;
	getFloorIndex(): number;
	getCoord(): GridCoord;
}

/**
 * Renderer-side reference to a genuinely dynamic world object.
 *
 * Gameplay state remains owned by the entity/system. The handle uses getters
 * so it always reads the authoritative current floor/coord instead of copying
 * that state into a second renderer-owned model.
 */
export class DynamicWorldHandle {
	readonly id: string;
	readonly kind: DynamicWorldKind;
	readonly view: Container;
	readonly renderKind: WorldObjectRenderKind;
	readonly lifetime: WorldObjectLifetime;
	private readonly getFloorIndex: () => number;
	private readonly getCoord: () => GridCoord;

	constructor(options: DynamicWorldHandleOptions) {
		this.id = options.id;
		this.kind = options.kind;
		this.view = options.view;
		this.renderKind = options.renderKind;
		this.lifetime = options.lifetime;
		this.getFloorIndex = options.getFloorIndex;
		this.getCoord = options.getCoord;
	}

	snapshot(): DynamicWorldSubject {
		return {
			id: this.id,
			kind: this.kind,
			floorIndex: this.getFloorIndex(),
			coord: {
				...this.getCoord(),
			},
			renderKind: this.renderKind,
			lifetime: this.lifetime,
		};
	}
}

/**
 * DynamicWorldHandle stores the stable renderer-side references for a dynamic
 * entity and getter functions into its authoritative gameplay state.
 * When another renderer system needs current information, snapshot()
 * reads the latest floor and coordinate and packages them with stable
 * metadata into a temporary DynamicWorldSubject.
 */
