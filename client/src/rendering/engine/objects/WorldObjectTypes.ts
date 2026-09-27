/**
 * Renderer shape used by dynamic/authored world objects.
 *
 * These names describe how the renderer should treat an object, not gameplay
 * wall/traversal semantics.
 */
export type WorldObjectRenderKind =
	| "sprite"
	| "facade"
	| "composite"
	| "procedural";

export type WorldObjectLifetime = "static" | "stateful" | "transient";

export interface WorldObjectIndentity {
	readonly id: string;
	readonly renderKind: WorldObjectRenderKind;
	readonly lifetime: WorldObjectLifetime;
}
