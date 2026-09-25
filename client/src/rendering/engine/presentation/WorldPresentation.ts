import * as RH from "@relic-hunter/shared";
import type { CompiledConnectorVisual } from "../compiler/CompiledFloorVisual";
import { FogCode, type FogPresentationBuffer } from "./FogPresentationBuffer";

/**
 * Static-world shader state.
 *
 * Numeric values deliberately match the ground presentation convention.
 */
export enum WorldPresentationCode {
	Hidden = 0,
	Washed = 1,
	Normal = 2,
}

function codeForCoord(
	coord: RH.GridCoord,
	mapWidth: number,
	fog: FogPresentationBuffer,
	outsideFocusedRoom: boolean,
	forceWashed: boolean,
): WorldPresentationCode {
	const tileIndex = coord.y * mapWidth + coord.x;
	const fogCode = fog.codeAtIndex(tileIndex);

	if (fogCode === FogCode.Unseen) {
		return WorldPresentationCode.Hidden;
	}
	if (fogCode === FogCode.Explored || outsideFocusedRoom || forceWashed) {
		return WorldPresentationCode.Washed;
	}
	return WorldPresentationCode.Normal;
}

function maxCode(
	a: WorldPresentationCode,
	b: WorldPresentationCode,
): WorldPresentationCode {
	return Math.max(a, b) as WorldPresentationCode;
}

/**
 * Terrain reproduces the legacy rule:
 *
 * - both endpoints unseen -> Hidden
 * - either endpoint fully normal -> Normal
 * - otherwise -> Washed
 */
export function resolveTerrainPresentation(
	visibilityCoords: readonly RH.GridCoord[],
	mapWidth: number,
	fog: FogPresentationBuffer,
	focusCellKeys: ReadonlySet<string> | null,
	forceWashed: boolean,
): WorldPresentationCode {
	let result = WorldPresentationCode.Hidden;

	for (const coord of visibilityCoords) {
		const outsideFocusedRoom =
			focusCellKeys !== null && !focusCellKeys.has(RH.coordKey(coord));
		result = maxCode(
			result,
			codeForCoord(coord, mapWidth, fog, outsideFocusedRoom, forceWashed),
		);
	}
	return result;
}

/**
 * Barrier room-focus semantics differ from ground/terrain.
 *
 * A focused room<s own boundary remains Normal and becomes physically shorter.
 * Other barriers become Washed while a room is focused.
 */
export function resolveBarrierPresentation(
	visibilityCoords: readonly RH.GridCoord[],
	mapWidth: number,
	fog: FogPresentationBuffer,
	hasFocusedRoom: boolean,
	isFocusedBoundary: boolean,
	forceWashed: boolean,
): WorldPresentationCode {
	const outsideFocusedRoom = hasFocusedRoom && !isFocusedBoundary;
	let result = WorldPresentationCode.Hidden;
	for (const coord of visibilityCoords) {
		result = maxCode(
			result,
			codeForCoord(coord, mapWidth, fog, outsideFocusedRoom, forceWashed),
		);
	}
	return result;
}

/**
 * A shared connector can touch several barrier edges.
 * Legacy behaviour chooses the strongest visible incident state:
 * Normal > Washed > Hidden
 */
export function resolveConnectorPresentation(
	connector: CompiledConnectorVisual,
	mapWidth: number,
	fog: FogPresentationBuffer,
	hasFocusedRoom: boolean,
	focusedEdgeIds: ReadonlySet<string>,
	forceWashed: boolean,
): WorldPresentationCode {
	let result = WorldPresentationCode.Hidden;
	for (const incident of connector.incidents) {
		const next = resolveBarrierPresentation(
			incident.visibilityCoords,
			mapWidth,
			fog,
			hasFocusedRoom,
			focusedEdgeIds.has(incident.edgeId),
			forceWashed,
		);
		result = maxCode(result, next);
	}
	return result;
}
