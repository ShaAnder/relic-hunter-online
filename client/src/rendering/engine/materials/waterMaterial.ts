const waterModules = import.meta.glob(
	"../../assets/map/tiles/water/water_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

export const WATER_TEXTURE_URLS: readonly string[] = Object.entries(
	waterModules,
)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([, url]) => url);
