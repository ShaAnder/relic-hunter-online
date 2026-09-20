const lowWallFaceModules = import.meta.glob(
	"../../assets/map/barriers/low-wall/face/low_wall_face_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

const lowWallTopModules = import.meta.glob(
	"../../assets/map/barriers/low-wall/top/low_wall_top_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

const lowWallConnectorModules = import.meta.glob(
	"../../assets/map/barriers/low-wall/connector/low_wall_connector_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

export const LOW_WALL_FACE_TEXTURE_URLS: readonly string[] =
	Object.entries(lowWallFaceModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);

export const LOW_WALL_TOP_TEXTURE_URLS: readonly string[] =
	Object.entries(lowWallTopModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);

export const LOW_WALL_CONNECTOR_TEXTURE_URLS: readonly string[] =
	Object.entries(lowWallConnectorModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);
