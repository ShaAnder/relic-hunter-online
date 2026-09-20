const wallFaceModules = import.meta.glob(
	"../../assets/map/barriers/wall/face/wall_face_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

const wallTopModules = import.meta.glob(
	"../../assets/map/barriers/wall/top/wall_top_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

const wallConnectorModules = import.meta.glob(
	"../../assets/map/barriers/wall/connector/wall_connector_*.png",
	{
		eager: true,
		import: "default",
	},
) as Record<string, string>;

export const WALL_FACE_TEXTURE_URLS: readonly string[] =
	Object.entries(wallFaceModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);

export const WALL_TOP_TEXTURE_URLS: readonly string[] =
	Object.entries(wallTopModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);

export const WALL_CONNECTOR_TEXTURE_URLS: readonly string[] =
	Object.entries(wallConnectorModules)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);
