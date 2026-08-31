#!/usr/bin/env node
/**
 * Pack per-action direction strips into a single sheet.png + atlas.json
 *
 * Layout (source):
 *   client/src/assets/characters/{class}/source/
 *     idle_se.png   (W = frames * cell, H = cell)
 *     walk_se.png
 *     attack_se.png
 *     ...
 *
 * Output:
 *   client/src/assets/characters/{class}/sheet.png
 *   client/src/assets/characters/{class}/atlas.json
 *
 * Usage:
 *   node scripts/pack-character-sheet.mjs brawler
 *   node scripts/pack-character-sheet.mjs brawler --cell 128
 *
 * Requires: sharp (npm i -D sharp) OR falls back to pure note if missing.
 * Prefer running from repo root with: npm i -D sharp -w client
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default: monorepo client assets
const REPO_CLIENT =
	process.env.RHO_CLIENT_ROOT ?? path.resolve(__dirname, "../client");

const CHARACTER = process.argv[2] ?? "brawler";
const cellArg = process.argv.indexOf("--cell");
const CELL = cellArg >= 0 ? Number(process.argv[cellArg + 1]) : 128;

const ISO_FACINGS = ["se", "sw", "ne", "nw"];
const ACTIONS = [
	"idle",
	"walk",
	"run",
	"attack",
	"hit",
	"stunned",
	"defeated",
	"victory",
];

const sourceDir = path.join(
	REPO_CLIENT,
	"src/assets/characters",
	CHARACTER,
	"source",
);
const outDir = path.join(REPO_CLIENT, "src/assets/characters", CHARACTER);

function die(msg) {
	console.error(`[pack-character-sheet] ${msg}`);
	process.exit(1);
}

if (!fs.existsSync(sourceDir)) {
	die(`Missing source dir: ${sourceDir}\nCreate strips under source/ first.`);
}

/** @type {{ key: string, anim: string, facing: string, path: string, frames: number }[]} */
const strips = [];

for (const file of fs.readdirSync(sourceDir)) {
	if (!file.toLowerCase().endsWith(".png")) continue;
	const base = file.replace(/\.png$/i, "").toLowerCase();
	// idle_se, walk_nw, ...
	const m = base.match(/^([a-z]+)_([a-z]+)$/);
	if (!m) {
		console.warn(`skip (name must be action_facing.png): ${file}`);
		continue;
	}
	const [, anim, facing] = m;
	if (!ACTIONS.includes(anim)) {
		console.warn(`skip unknown action "${anim}": ${file}`);
		continue;
	}
	if (!ISO_FACINGS.includes(facing)) {
		console.warn(`skip unknown facing "${facing}" (use ne|se|sw|nw): ${file}`);
		continue;
	}
	strips.push({
		key: `${anim}_${facing}`,
		anim,
		facing,
		path: path.join(sourceDir, file),
		frames: 0, // filled after load
	});
}

if (strips.length === 0) die(`No valid strips in ${sourceDir}`);

async function main() {
	let sharp;
	try {
		sharp = (await import("sharp")).default;
	} catch {
		die(
			"sharp is required. From repo root: npm i -D sharp --workspace=client\n" +
				"Or: cd client && npm i -D sharp",
		);
	}

	// Measure each strip
	for (const s of strips) {
		const meta = await sharp(s.path).metadata();
		const w = meta.width ?? 0;
		const h = meta.height ?? 0;
		if (h !== CELL) {
			console.warn(
				`${s.key}: height ${h} !== cell ${CELL} — will resize height to ${CELL}`,
			);
		}
		if (w % CELL !== 0) {
			die(`${s.key}: width ${w} not divisible by cell ${CELL}`);
		}
		s.frames = Math.floor(w / CELL);
		if (s.frames < 1) die(`${s.key}: no frames`);
		console.log(`  ${s.key}: ${s.frames} frames (${w}×${h})`);
	}

	// Pack order: stable by action then facing
	const order = [...strips].sort((a, b) => {
		const ai = ACTIONS.indexOf(a.anim);
		const bi = ACTIONS.indexOf(b.anim);
		if (ai !== bi) return ai - bi;
		return ISO_FACINGS.indexOf(a.facing) - ISO_FACINGS.indexOf(b.facing);
	});

	const rows = order.length;
	const maxFrames = Math.max(...order.map((s) => s.frames));
	const sheetW = maxFrames * CELL;
	const sheetH = rows * CELL;

	/** row index per anim/facing for atlas */
	const rowMap = {};
	const composites = [];

	for (let row = 0; row < order.length; row++) {
		const s = order[row];
		rowMap[`${s.anim}/${s.facing}`] = row;
		// also plain anim key = first facing we see for that anim
		if (rowMap[s.anim] === undefined) rowMap[s.anim] = row;

		// Left-align frames in the row
		const buf = await sharp(s.path)
			.resize({
				height: CELL,
				width: s.frames * CELL,
				fit: "fill",
				kernel: "nearest",
			})
			.ensureAlpha()
			.png()
			.toBuffer();

		composites.push({
			input: buf,
			left: 0,
			top: row * CELL,
		});
	}

	fs.mkdirSync(outDir, { recursive: true });

	const sheetPath = path.join(outDir, "sheet.png");
	await sharp({
		create: {
			width: sheetW,
			height: sheetH,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite(composites)
		.png()
		.toFile(sheetPath);

	const atlas = {
		characterClass: CHARACTER,
		frameWidth: CELL,
		frameHeight: CELL,
		columns: maxFrames,
		rows: rowMap,
		strips: order.map((s, i) => ({
			anim: s.anim,
			facing: s.facing,
			row: i,
			frames: s.frames,
			source: path.basename(s.path),
		})),
		generatedAt: new Date().toISOString(),
	};

	const atlasPath = path.join(outDir, "atlas.json");
	fs.writeFileSync(atlasPath, JSON.stringify(atlas, null, 2));

	console.log(`\nWrote ${sheetPath} (${sheetW}×${sheetH})`);
	console.log(`Wrote ${atlasPath}`);
	console.log(`Rows: ${rows}, max frames/row: ${maxFrames}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
