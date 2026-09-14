/**
 * Small, disposable test map for the edge-based wall prototype —
 * NOT a real map. A single 3x3 room (interior at logical (1,1)-(3,3))
 * surrounded by open floor, with full walls on every side except one
 * door on the south wall at (2,3)-(2,4). Exists purely to prove out
 * compileEdgeMap, edge-aware movement, and edge-aware rendering
 * before converting any real map to this format.
 *
 * Double-resolution format: for a logical WxH map this is a
 * (2W-1)x(2H-1) array. Even,even positions are tile codes
 * (EdgeMapTileCode); odd,even and even,odd positions are edge
 * barrier codes (EdgeBarrier); odd,odd positions are always 0
 * (no diagonal walls).
 */
export const EDGE_TEST_BLUEPRINT: number[][] = [
	[1,0,1,0,1,0,1,0,1],
	[0,0,2,0,2,0,2,0,0],
	[1,2,2,0,2,0,2,2,1],
	[0,0,0,0,0,0,0,0,0],
	[1,2,2,0,2,0,2,2,1],
	[0,0,0,0,0,0,0,0,0],
	[1,2,2,0,2,0,2,2,1],
	[0,0,2,0,5,0,2,0,0],
	[1,0,1,0,1,0,1,0,1],
];