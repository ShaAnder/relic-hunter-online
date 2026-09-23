import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();

const SEARCH_ROOTS = [
	"client/src/assets",
	"client/public",
];

const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
]);

const REPEATING_MATERIAL_MAX_DIMENSION = 512;
const WARN_COMPRESSED_BYTES = 1024 * 1024;

async function walk(relativeDirectory) {
	const absoluteDirectory = path.join(root, relativeDirectory);
	const entries = await readdir(absoluteDirectory, {
		withFileTypes: true,
	});

	const result = [];

	for (const entry of entries) {
		const relativePath = path.join(relativeDirectory, entry.name);

		if (entry.isDirectory()) {
			result.push(...(await walk(relativePath)));
		} else {
			result.push(relativePath);
		}
	}

	return result;
}

const paths = [];

for (const searchRoot of SEARCH_ROOTS) {
	try {
		paths.push(...(await walk(searchRoot)));
	} catch {
		// A root may not exist in every workspace configuration.
	}
}

const rows = [];

for (const relativePath of paths) {
	const extension = path.extname(relativePath).toLowerCase();

	if (!IMAGE_EXTENSIONS.has(extension)) continue;

	const absolutePath = path.join(root, relativePath);
	const fileStat = await stat(absolutePath);

	let width = null;
	let height = null;

	try {
		const metadata = await sharp(absolutePath).metadata();
		width = metadata.width ?? null;
		height = metadata.height ?? null;
	} catch {
		// Leave dimensions blank if Sharp cannot read a file.
	}

	const estimatedRgbaBytes =
		width !== null && height !== null
			? width * height * 4
			: null;

	const isRepeatingMapMaterial =
		relativePath.includes(
			path.join("client", "src", "assets", "map"),
		);

	const warnings = [];

	if (fileStat.size >= WARN_COMPRESSED_BYTES) {
		warnings.push("compressed>1MiB");
	}

	if (
		isRepeatingMapMaterial &&
		width !== null &&
		height !== null &&
		Math.max(width, height) > REPEATING_MATERIAL_MAX_DIMENSION
	) {
		warnings.push("map-material>512px");
	}

	rows.push({
		path: relativePath,
		width,
		height,
		compressedKiB: Math.round(fileStat.size / 1024),
		estimatedRgbaMiB:
			estimatedRgbaBytes === null
				? null
				: Number(
						(estimatedRgbaBytes / 1024 / 1024).toFixed(2),
					),
		warnings: warnings.join(", "),
	});
}

rows.sort((a, b) => b.compressedKiB - a.compressedKiB);

console.table(rows);

const warningCount = rows.filter((row) => row.warnings.length > 0).length;

if (warningCount > 0) {
	console.warn(
		`\nAsset report: ${warningCount} image(s) exceed the current warning policy.`,
	);
}
