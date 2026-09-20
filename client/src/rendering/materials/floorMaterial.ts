const floorModules = import.meta.glob(
	"../../assets/map/tiles/floor/floor_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

export const FLOOR_TEXTURE_URLS: readonly string[] = Object.entries(
	floorModules,
)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([, url]) => url);
