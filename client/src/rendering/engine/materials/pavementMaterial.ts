const pavementModules = import.meta.glob(
	"../../assets/map/tiles/pavement/pavement_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

export const PAVEMENT_TEXTURE_URLS: readonly string[] = Object.entries(
	pavementModules,
)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([, url]) => url);
