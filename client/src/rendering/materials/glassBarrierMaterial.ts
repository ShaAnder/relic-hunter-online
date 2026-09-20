const glassPanelModules = import.meta.glob(
	"../../assets/map/barriers/glass/panel/glass_panel_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

const glassMullionModules = import.meta.glob(
	"../../assets/map/barriers/glass/mullion/glass_mullion_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

export const GLASS_PANEL_TEXTURE_URLS: readonly string[] =
	Object.entries(glassPanelModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);

export const GLASS_MULLION_TEXTURE_URLS: readonly string[] =
	Object.entries(glassMullionModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);
