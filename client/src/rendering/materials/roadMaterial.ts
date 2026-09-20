/**
 * Road Texture discovery inside the asset folder
 */
const roadModules = import.meta.glob("../../assets/map/tiles/road/road_*.png", {
	eager: true,
	import: "default",
}) as Record<string, string>;

export const ROAD_TEXTURE_URLS: readonly string[] = Object.entries(roadModules)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([, url]) => url);
