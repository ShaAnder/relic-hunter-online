const grassModules = import.meta.glob(
	"../../assets/map/tiles/grass/grass_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

export const GRASS_TEXTURE_URLS: readonly string[] = Object.entries(
	grassModules,
)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([, url]) => url);
