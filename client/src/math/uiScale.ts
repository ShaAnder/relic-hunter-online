/**
 * Global UI scale for Relic Hunter Online.
 *
 * Author all HUD/overlay chrome at desktop pixel sizes, then multiply by
 * computeUiScale(screenW, screenH). Never distorts (uniform X/Y).
 * Board / camera / world tiles are NOT scaled by this — only UI.
 *
 * @author ShaAnder
 */

/** Design canvas the HUD was authored against. */
export const UI_DESIGN_W = 960;
export const UI_DESIGN_H = 540;

/**
 * Character panel design width — used to cap HUD so chrome never owns
 * more than MAX_PANEL_FRACTION of screen width on phones.
 */
export const UI_PANEL_DESIGN_W = 316;

/** Soft ceiling: primary panel ≤ this fraction of viewport width. */
export const UI_MAX_PANEL_FRACTION = 0.28;

/** Floor so text/controls stay tappable on very small screens. */
export const UI_MIN_SCALE = 0.42;

/** Optional user/accessibility multiplier (1 = default). */
let userUiScale = 1;

export function setUserUiScale(mult: number): void {
	userUiScale = Math.max(0.75, Math.min(1.5, mult));
}

export function getUserUiScale(): number {
	return userUiScale;
}

/**
 * Single factor for all UI. Prefer this over computeFitScale for HUD.
 * - Fits design canvas (never above 1 × user mult unless user asks larger)
 * - Caps so a 316px panel stays within MAX_PANEL_FRACTION of width
 * - Floors at UI_MIN_SCALE for readability
 */
export function computeUiScale(screenW: number, screenH: number): number {
	const fit = Math.min(
		1,
		screenW / UI_DESIGN_W,
		screenH / UI_DESIGN_H,
	);
	const panelCap = (screenW * UI_MAX_PANEL_FRACTION) / UI_PANEL_DESIGN_W;
	const raw = Math.min(fit, panelCap);
	return Math.max(UI_MIN_SCALE, raw) * userUiScale;
}

/** Screen-space length: designPixels * scale */
export function uiPx(designPx: number, scale: number): number {
	return designPx * scale;
}
