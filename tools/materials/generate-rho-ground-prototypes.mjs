import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const manifestPath = path.join(here, "rho-material-style-lock.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

const { width, height } = manifest.tileSize;

for (const material of manifest.materials) {
	const outputDir = path.join(
		repoRoot,
		"client/src/assets/map/tiles",
		material.folder,
	);

	await fs.mkdir(outputDir, { recursive: true });

	for (let variant = 0; variant < material.variantCount; variant++) {
		const rng = mulberry32(hash(`${material.id}:${variant}`));
		const svg = buildVariantSvg(material, rng);
		const filename = `${safeFileStem(material.id)}_${String(variant).padStart(2, "0")}.png`;

		await sharp(Buffer.from(svg)).png().toFile(path.join(outputDir, filename));
	}
}

console.log(`Generated RHO material prototypes from ${manifestPath}`);

function buildVariantSvg(material, rng) {
	const [minPatches, maxPatches] = material.patchCount;
	const patchCount = randomInt(rng, minPatches, maxPatches);
	const [minOpacity, maxOpacity] = material.patchOpacity;
	const marginX = width * material.innerMargin;
	const marginY = height * material.innerMargin;

	const shapes = [];

	for (let i = 0; i < patchCount; i++) {
		const fill = pick(rng, material.shades);
		const opacity = randomRange(rng, minOpacity, maxOpacity);
		const cx = randomRange(rng, marginX, width - marginX);
		const cy = randomRange(rng, marginY, height - marginY);
		const rx = randomRange(rng, 7, 20);
		const ry = randomRange(rng, 3, 9);
		const rotation = randomRange(rng, -28, 28);

		shapes.push(
			`<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" ` +
				`rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" ` +
				`fill="${fill}" opacity="${opacity.toFixed(3)}" ` +
				`transform="rotate(${rotation.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)})" />`,
		);
	}

	const [minAccents, maxAccents] = material.accentCount;
	const accentCount = randomInt(rng, minAccents, maxAccents);
	const [minRadius, maxRadius] = material.accentRadius;

	for (let i = 0; i < accentCount; i++) {
		const fill = pick(rng, material.accents);
		const cx = randomRange(rng, marginX * 1.2, width - marginX * 1.2);
		const cy = randomRange(rng, marginY * 1.2, height - marginY * 1.2);
		const radius = randomRange(rng, minRadius, maxRadius);

		shapes.push(
			`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" ` +
				`r="${radius.toFixed(2)}" fill="${fill}" opacity="0.72" />`,
		);
	}

	return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
	<rect width="${width}" height="${height}" fill="${material.base}" />
	<g>${shapes.join("")}</g>
</svg>`;
}

function safeFileStem(id) {
	return id.replaceAll(".", "_").replaceAll("-", "_");
}

function pick(rng, values) {
	return values[Math.floor(rng() * values.length)];
}

function randomInt(rng, min, max) {
	return Math.floor(randomRange(rng, min, max + 1));
}

function randomRange(rng, min, max) {
	return min + (max - min) * rng();
}

function hash(value) {
	let h = 2166136261;

	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}

	return h >>> 0;
}

function mulberry32(seed) {
	return () => {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
