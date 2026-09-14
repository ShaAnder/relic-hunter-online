import { ALLEYWAYS_MAP_BLUEPRINT } from "./alleywaysMapBlueprint";
import {
	compileAlleywaysEdgeMap,
	type AlleywaysEdgeMap,
} from "./alleywaysEdgeMigration";

/**
 * Ground-floor Alleyways map using the edge-wall system.
 *
 * IMPORTANT:
 * This file intentionally imports ONLY the ground-floor blueprint.
 *
 * Floor 2 is not imported, compiled, referenced, merged, or loaded here.
 * The edge prototype therefore has exactly one source map:
 *
 *   ALLEYWAYS_MAP_BLUEPRINT
 *
 * No second-floor data can enter ALLEYWAYS_EDGE_MAP through this module.
 */
export const ALLEYWAYS_EDGE_MAP: AlleywaysEdgeMap =
	compileAlleywaysEdgeMap(ALLEYWAYS_MAP_BLUEPRINT);
