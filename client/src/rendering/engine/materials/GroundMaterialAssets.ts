import type { GroundMaterialDefinition } from "./GroundMaterialCatalog";

export interface GroundAssetRef {
	sourcePath: string;
	url: string;
}

const groundModules = import.meta.glob("../../../assets/map/tiles/**/*.png", {
	eager: true,
	import: "default",
}) as Record<string, string>;

export function groundAssetsForFolder(
	folder: string | null,
): readonly GroundAssetRef[] {
	if (!folder) {
		return [];
	}

	const marker = `/assets/map/tiles/${folder}/`;

	return Object.entries(groundModules)
		.filter(([sourcePath]) => sourcePath.includes(marker))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([sourcePath, url]) => ({
			sourcePath,
			url,
		}));
}

export function baseAssetsForGroundMaterial(
	definition: GroundMaterialDefinition,
): readonly GroundAssetRef[] {
	return groundAssetsForFolder(definition.textureFolder);
}

export function edgeAssetsForGroundMaterial(
	definition: GroundMaterialDefinition,
): readonly GroundAssetRef[] {
	const treatment = definition.edgeTreatment;

	if (!treatment) {
		return [];
	}

	return groundAssetsForFolder(
		treatment.kind === "border"
			? treatment.textureFolder
			: treatment.maskFolder,
	);
}

export function allAssetsForGroundMaterial(
	definition: GroundMaterialDefinition,
): readonly GroundAssetRef[] {
	return [
		...baseAssetsForGroundMaterial(definition),
		...edgeAssetsForGroundMaterial(definition),
	];
}
