/**
 * RHO material art-direction palette.
 *
 * Generated from tools/materials/rho-material-style-lock.json.
 * These are visual-authoring colours only; they carry no gameplay meaning.
 */
export const RHO_MATERIAL_PALETTE = {
	ink: 0x2c1b2b,
	shadowPlum: 0x43273d,
	shadowWine: 0x522c3e,
	mossDark: 0x506248,
	mossMid: 0x6c8253,
	grassBase: 0x748752,
	grassLight: 0x869057,
	grassSun: 0xa2a176,
	earthDark: 0x71454b,
	earthBase: 0x926e52,
	earthLight: 0xb8986e,
	terracotta: 0xa54039,
	stoneShadow: 0x776e79,
	stoneMid: 0x959b9c,
	stoneLight: 0xaba4b0,
	warmHighlight: 0xbfb168,
	waterDeep: 0x454e91,
	waterBase: 0x515c99,
	waterLift: 0x6e627c,
} as const;

export type RhoMaterialPaletteKey = keyof typeof RHO_MATERIAL_PALETTE;
