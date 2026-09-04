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
 *
 * CELL is intentionally hardcoded, not a CLI flag — this exact
 * override was how a 32px sheet once got packed against code that
 * assumed 128px everywhere else, producing a sprite a quarter its
 * intended size with zero warning at runtime. The frame size is a
 * single global invariant (see client/src/types/characterSprite.ts);
 * changing it means changing it deliberately in both places, not via
 * a flag someone can pass once and forget.
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

// Must match SPRITE_FRAME_WIDTH/HEIGHT in client/src/types/characterSprite.ts exactly.
const CELL = 128;
// How many pixels of tolerance before the feet-position check warns —
// small enough to catch a genuinely wrong strip, loose enough to allow
// normal anti-aliasing noise at the very bottom edge.
const FEET_TOLERANCE_PX = 3;
// Alpha values at/below this are treated as "transparent" when
// scanning for the lowest opaque row.
const ALPHA_THRESHOLD = 10;

const ISO_FACINGS = ["se", "sw", "ne", "nw"];
const ACTIONS = [
	"idle",
	"walk",
	"run",
	"attack",
	"defend",
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

function warn(msg) {
	console.warn(`[pack-character-sheet] WARNING: ${msg}`);
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

/**
 * Scans the first frame's alpha channel from the bottom up and
 * returns the row index of the lowest (highest-y) pixel that isn't
 * transparent. Only checks frame 0 — enough to catch a strip that's
 * systematically off, without the cost of scanning every frame.
 * Returns -1 if the whole frame is transparent (itself a real
 * problem worth surfacing, not this function's job to fix).
 */
async function findFeetRow(sharp, imagePath, cellWidth, cellHeight) {
	const { data, info } = await sharp(imagePath)
		.extract({ left: 0, top: 0, width: cellWidth, height: cellHeight })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const channels = info.channels;
	for (let y = cellHeight - 1; y >= 0; y--) {
		for (let x = 0; x < cellWidth; x++) {
			const idx = (y * cellWidth + x) * channels + (channels - 1);
			if (data[idx] > ALPHA_THRESHOLD) return y;
		}
	}
	return -1;
}

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

	// Measure + strictly validate each strip. No silent resize: a
	// mismatched size is a build-breaking error, not a warning, since
	// resizing to fit would stretch/distort art that was never actually
	// the right size to begin with.
	for (const s of strips) {
		const meta = await sharp(s.path).metadata();
		const w = meta.width ?? 0;
		const h = meta.height ?? 0;

		if (h !== CELL) {
			die(
				`${s.key}: height ${h}px does not match the required cell size ${CELL}px. ` +
					`Fix the source art's height exactly — this script will not silently resize it.`,
			);
		}
		if (w % CELL !== 0) {
			die(
				`${s.key}: width ${w}px is not an exact multiple of ${CELL}px. ` +
					`Crop or pad the source strip to a whole number of ${CELL}px frames.`,
			);
		}
		s.frames = Math.floor(w / CELL);
		if (s.frames < 1) die(`${s.key}: no frames`);

		const feetRow = await findFeetRow(sharp, s.path, CELL, CELL);
		if (feetRow === -1) {
			warn(
				`${s.key}: frame 0 appears fully transparent — check the source art.`,
			);
		} else if (CELL - 1 - feetRow > FEET_TOLERANCE_PX) {
			warn(
				`${s.key}: lowest opaque pixel is at row ${feetRow} of ${CELL - 1} ` +
					`(${CELL - 1 - feetRow}px of empty space below the feet). ` +
					`Convention is feet at the exact frame bottom — crop this strip tighter or the character will float above the tile.`,
			);
		}

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

		// Every strip is already validated to be exactly frames*CELL ×
		// CELL — this composite just places it, no resize/distortion.
		const buf = await sharp(s.path).ensureAlpha().png().toBuffer();

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
