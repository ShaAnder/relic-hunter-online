const fencePanelModules = import.meta.glob(
	"../../assets/map/barriers/fence/panel/fence_panel_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

const fencePostModules = import.meta.glob(
	"../../assets/map/barriers/fence/post/fence_post_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

export const FENCE_PANEL_TEXTURE_URLS: readonly string[] =
	Object.entries(fencePanelModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);

export const FENCE_POST_TEXTURE_URLS: readonly string[] =
	Object.entries(fencePostModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);
