/**
 * Authored terrain elevation is stored as an INTEGER STEP.
 *
 * The integer is gameplay/editor data.
 * The mapped number is render/world height.
 *
 * Nothing should independently calculate:
 *
 *     step * 0.1
 *
 * outside this file. If we ever retune the elevation curve, this table
 * is the one place that changes.
 *
 * At the current isometric scale:
 *
 *     world height 0.1
 *     × TILE_HEIGHT 40
 *     = 4 screen pixels
 *
 * Therefore:
 *
 *     step +1  = +0.1 =  4px
 *     step +2  = +0.2 =  8px
 *     step +10 = +1.0 = 40px
 */
export type ElevationStep =
	| -10
	| -9
	| -8
	| -7
	| -6
	| -5
	| -4
	| -3
	| -2
	| -1
	| 0
	| 1
	| 2
	| 3
	| 4
	| 5
	| 6
	| 7
	| 8
	| 9
	| 10;

export const MIN_ELEVATION_STEP: ElevationStep = -10;
export const MAX_ELEVATION_STEP: ElevationStep = 10;

export const ELEVATION_HEIGHT_BY_STEP: Readonly<Record<ElevationStep, number>> =
	{
		[-10]: -1,
		[-9]: -0.9,
		[-8]: -0.8,
		[-7]: -0.7,
		[-6]: -0.6,
		[-5]: -0.5,
		[-4]: -0.4,
		[-3]: -0.3,
		[-2]: -0.2,
		[-1]: -0.1,
		[0]: 0,
		[1]: 0.1,
		[2]: 0.2,
		[3]: 0.3,
		[4]: 0.4,
		[5]: 0.5,
		[6]: 0.6,
		[7]: 0.7,
		[8]: 0.8,
		[9]: 0.9,
		[10]: 1,
	};

/**
 * A visually smooth staircase progresses at most one authored step per
 * cardinal stair edge.
 */
export const MAX_STAIR_EDGE_DELTA_STEPS = 1;

export function clampElevationStep(value: number): ElevationStep {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.max(
		MIN_ELEVATION_STEP,
		Math.min(MAX_ELEVATION_STEP, Math.round(value)),
	) as ElevationStep;
}

/**
 * THE conversion from authored elevation step to physical height.
 */
export function elevationHeightForStep(step: number): number {
	return ELEVATION_HEIGHT_BY_STEP[clampElevationStep(step)];
}
