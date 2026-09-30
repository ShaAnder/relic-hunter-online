import type { GroundMaterialDefinition } from "./GroundMaterialCatalog";

const groundModules = import.meta.glob("../../assets/map/tiles/**/*.png", {
	eager: true,
	import: "default",
}) as Record<string, string>;

export function textureUrlsForGroundMaterial(
	definition: GroundMaterialDefinition,
): readonly string[] {
	if (!definition.textureFolder) {
		return [];
	}
	const marker = `/assets/map/tiles/${definition.textureFolder}/`;
	return Object.entries(groundModules)
		.filter(([path]) => path.includes(marker))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, url]) => url);
}
