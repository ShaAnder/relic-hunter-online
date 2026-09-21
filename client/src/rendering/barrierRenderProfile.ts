import { EdgeBarrier } from "@relic-hunter/shared";

/**
 * Render-only barrier geometry profile.
 *
 * EdgeBarrier remains the semantic identity. This table says how that
 * identity should be presented by the generic barrier renderer.
 *
 * Adding a future barrier should primarily mean adding one profile rather
 * than adding another branch throughout MapRenderer.
 */
export type BarrierGeometryKind = "solid" | "panel";
export type BarrierTerrainOcclusion = "none" | "front-tile";

export interface BarrierRenderProfile {
	geometryKind: BarrierGeometryKind;
	heightFraction: number;

	segmentThicknessPx: number;
	segmentTopColor: number;
	segmentLeftColor: number;
	segmentRightColor: number;
	segmentAlpha: number;
	showSegmentTop: boolean;
	extendSegmentToFoundation: boolean;

	connectorHalfPx: number;
	connectorTopColor: number;
	connectorLeftColor: number;
	connectorRightColor: number;
	connectorAlpha: number;
	showConnector: boolean;
	showConnectorTop: boolean;
	connectorPriority: number;

	terrainOcclusion: BarrierTerrainOcclusion;

	/** Texture cycles per structural edge / normal wall storey. */
	faceUvPerEdge: number;
	faceUvPerStorey: number;
}

const GAP_PX = 7;
const SOLID_BARRIER_THICKNESS_PX = GAP_PX;
const PANEL_BARRIER_THICKNESS_PX = 1.5;

const SOLID_CONNECTOR_HALF_PX = SOLID_BARRIER_THICKNESS_PX;
const POST_CONNECTOR_HALF_PX = 3;
const MULLION_CONNECTOR_HALF_PX = 2.5;

const WALL_TOP_COLOR = 0x463c6e;
const WALL_LEFT_FACE_COLOR = 0x2d2648;
const WALL_RIGHT_FACE_COLOR = 0x372f58;

const DOOR_TOP_COLOR = 0xc8b43c;
const DOOR_LEFT_FACE_COLOR = 0x8c7d28;
const DOOR_RIGHT_FACE_COLOR = 0xaa9632;

const FENCE_TOP_COLOR = 0x4a5c3c;
const FENCE_LEFT_FACE_COLOR = 0x323f28;
const FENCE_RIGHT_FACE_COLOR = 0x3d4c32;
const FENCE_PANEL_ALPHA = 0.3;
const FENCE_POST_TOP_COLOR = 0x8b949b;
const FENCE_POST_LEFT_COLOR = 0x596168;
const FENCE_POST_RIGHT_COLOR = 0x6c757c;

const GLASS_TOP_COLOR = 0x7d94a0;
const GLASS_LEFT_FACE_COLOR = 0x56666f;
const GLASS_RIGHT_FACE_COLOR = 0x687d87;
const GLASS_PANEL_ALPHA = 0.32;
const GLASS_MULLION_TOP_COLOR = 0x9aa6ad;
const GLASS_MULLION_LEFT_COLOR = 0x636d73;
const GLASS_MULLION_RIGHT_COLOR = 0x778289;

const LOW_WALL_TOP_COLOR = 0x5c5648;
const LOW_WALL_LEFT_FACE_COLOR = 0x3e3a30;
const LOW_WALL_RIGHT_FACE_COLOR = 0x4a4539;

const FULL_WALL: BarrierRenderProfile = {
	geometryKind: "solid",
	heightFraction: 1,
	segmentThicknessPx: SOLID_BARRIER_THICKNESS_PX,
	segmentTopColor: WALL_TOP_COLOR,
	segmentLeftColor: WALL_LEFT_FACE_COLOR,
	segmentRightColor: WALL_RIGHT_FACE_COLOR,
	segmentAlpha: 1,
	showSegmentTop: true,
	extendSegmentToFoundation: true,
	connectorHalfPx: SOLID_CONNECTOR_HALF_PX,
	connectorTopColor: WALL_TOP_COLOR,
	connectorLeftColor: WALL_LEFT_FACE_COLOR,
	connectorRightColor: WALL_RIGHT_FACE_COLOR,
	connectorAlpha: 1,
	showConnector: true,
	showConnectorTop: true,
	connectorPriority: 50,
	terrainOcclusion: "none",
	faceUvPerEdge: 0.5,
	faceUvPerStorey: 0.5,
};

const PROFILES: Partial<Record<EdgeBarrier, BarrierRenderProfile>> = {
	[EdgeBarrier.FullWall]: FULL_WALL,

	[EdgeBarrier.Door]: {
		...FULL_WALL,
		heightFraction: 0.3,
		segmentTopColor: DOOR_TOP_COLOR,
		segmentLeftColor: DOOR_LEFT_FACE_COLOR,
		segmentRightColor: DOOR_RIGHT_FACE_COLOR,
		connectorTopColor: DOOR_TOP_COLOR,
		connectorLeftColor: DOOR_LEFT_FACE_COLOR,
		connectorRightColor: DOOR_RIGHT_FACE_COLOR,
		connectorPriority: 40,
	},

	[EdgeBarrier.Fence]: {
		geometryKind: "panel",
		heightFraction: 1,
		segmentThicknessPx: PANEL_BARRIER_THICKNESS_PX,
		segmentTopColor: FENCE_TOP_COLOR,
		segmentLeftColor: FENCE_LEFT_FACE_COLOR,
		segmentRightColor: FENCE_RIGHT_FACE_COLOR,
		segmentAlpha: FENCE_PANEL_ALPHA,
		showSegmentTop: false,
		extendSegmentToFoundation: false,
		connectorHalfPx: POST_CONNECTOR_HALF_PX,
		connectorTopColor: FENCE_POST_TOP_COLOR,
		connectorLeftColor: FENCE_POST_LEFT_COLOR,
		connectorRightColor: FENCE_POST_RIGHT_COLOR,
		connectorAlpha: 1,
		showConnector: true,
		showConnectorTop: true,
		connectorPriority: 20,
		terrainOcclusion: "front-tile",
		faceUvPerEdge: 1,
		faceUvPerStorey: 1,
	},

	[EdgeBarrier.Glass]: {
		geometryKind: "panel",
		heightFraction: 1,
		segmentThicknessPx: PANEL_BARRIER_THICKNESS_PX,
		segmentTopColor: GLASS_TOP_COLOR,
		segmentLeftColor: GLASS_LEFT_FACE_COLOR,
		segmentRightColor: GLASS_RIGHT_FACE_COLOR,
		segmentAlpha: GLASS_PANEL_ALPHA,
		showSegmentTop: false,
		extendSegmentToFoundation: false,
		connectorHalfPx: MULLION_CONNECTOR_HALF_PX,
		connectorTopColor: GLASS_MULLION_TOP_COLOR,
		connectorLeftColor: GLASS_MULLION_LEFT_COLOR,
		connectorRightColor: GLASS_MULLION_RIGHT_COLOR,
		connectorAlpha: 1,
		showConnector: true,
		showConnectorTop: true,
		connectorPriority: 30,
		terrainOcclusion: "front-tile",
		faceUvPerEdge: 1,
		faceUvPerStorey: 1,
	},

	[EdgeBarrier.LowWall]: {
		...FULL_WALL,
		heightFraction: 0.45,
		segmentTopColor: LOW_WALL_TOP_COLOR,
		segmentLeftColor: LOW_WALL_LEFT_FACE_COLOR,
		segmentRightColor: LOW_WALL_RIGHT_FACE_COLOR,
		connectorTopColor: LOW_WALL_TOP_COLOR,
		connectorLeftColor: LOW_WALL_LEFT_FACE_COLOR,
		connectorRightColor: LOW_WALL_RIGHT_FACE_COLOR,
		connectorPriority: 10,
	},
};

export function barrierRenderProfileFor(
	barrier: EdgeBarrier,
): BarrierRenderProfile {
	return PROFILES[barrier] ?? FULL_WALL;
}

export function connectorPriorityFor(
	barrier: EdgeBarrier,
): number {
	return barrierRenderProfileFor(barrier).connectorPriority;
}
