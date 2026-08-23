/**
 * Uniform scale factor to fit content designed at (designW, designH)
 * into whatever space is actually available — never scales up past 1,
 * only shrinks when the real viewport is smaller than the design size.
 * Single factor, not separate X/Y, so nothing ever distorts.
 */
export function computeFitScale(
	availableWidth: number,
	availableHeight: number,
	designWidth: number,
	designHeight: number,
): number {
	return Math.min(
		1,
		availableWidth / designWidth,
		availableHeight / designHeight,
	);
}
