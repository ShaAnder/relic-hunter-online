import { FogCode } from "./FogPresentationBuffer";

/**
 * Final state consumed by the ground shader.
 *
 * Hidden  = do not emit ground pixels.
 * Washed  = explored fog or outside the focused room.
 * Normal  = fully visible ground.
 */
export enum GroundPresentationCode {
	Hidden = 0,
	Washed = 1,
	Normal = 2,
}

export function resolveGroundPresentationCode(
	fogCode: FogCode,
	outsideFocusedRoom: boolean,
	forceWashed: boolean,
): GroundPresentationCode {
	if (fogCode === FogCode.Unseen) {
		return GroundPresentationCode.Hidden;
	}

	if (fogCode === FogCode.Explored || outsideFocusedRoom || forceWashed) {
		return GroundPresentationCode.Washed;
	}

	return GroundPresentationCode.Normal;
}
