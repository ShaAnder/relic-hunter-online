import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();

const rules = [
	{
		name: "shared must not import client",
		directories: ["shared/src"],
		forbidden: [
			/from\s+["'][^"']*(?:client\/|@\/)/,
			/import\s*\(\s*["'][^"']*(?:client\/|@\/)/,
		],
	},
	{
		name: "shared must not import PixiJS",
		directories: ["shared/src"],
		forbidden: [/from\s+["']pixi\.js["']/, /import\s*\(\s*["']pixi\.js["']/],
	},
	{
		name: "shared must not use DOM/browser globals through imports",
		directories: ["shared/src"],
		forbidden: [/from\s+["'](?:dom|jsdom|happy-dom)["']/],
	},
	{
		name: "tutorial scripts must not import MapScene",
		directories: ["client/src/tutorial/scripts"],
		forbidden: [
			/from\s+["'][^"']*scenes\/MapScene["']/,
			/from\s+["'][^"']*MapScene["']/,
		],
	},
	{
		name: "tutorial scripts must not import BattleOverlay",
		directories: ["client/src/tutorial/scripts"],
		forbidden: [/from\s+["'][^"']*BattleOverlay["']/],
	},
	{
		name: "BattleOverlay must not import tutorial scripts",
		files: ["client/src/ui/overlay/BattleOverlay.ts"],
		forbidden: [/from\s+["'][^"']*tutorial\/scripts["']/],
	},
	{
		name: "BattleOverlay must not import MapScene",
		files: ["client/src/ui/overlay/BattleOverlay.ts"],
		forbidden: [
			/from\s+["'][^"']*scenes\/MapScene["']/,
			/from\s+["'][^"']*MapScene["']/,
		],
	},
	{
		name: "client must not import server implementation",
		directories: ["client/src"],
		forbidden: [
			/from\s+["'][^"']*(?:server\/|server\/src\/)/,
			/import\s*\(\s*["'][^"']*(?:server\/|server\/src\/)/,
		],
	},
];

async function walk(directory) {
	const entries = await readdir(join(root, directory), {
		withFileTypes: true,
	});

	const files = [];

	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === "dist") {
			continue;
		}

		const path = join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await walk(path)));
		} else if (/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(entry.name)) {
			files.push(path);
		}
	}

	return files;
}

function ruleAppliesToFile(rule, file) {
	if (rule.files?.includes(file)) {
		return true;
	}

	return rule.directories?.some(
		(directory) => file === directory || file.startsWith(`${directory}/`),
	);
}

let failures = 0;

for (const rule of rules) {
	const candidateFiles = new Set(rule.files ?? []);

	for (const directory of rule.directories ?? []) {
		try {
			const files = await walk(directory);

			for (const file of files) {
				candidateFiles.add(file);
			}
		} catch {
			// A directory may not exist yet. That is fine during incremental refactors.
		}
	}

	for (const file of candidateFiles) {
		if (!ruleAppliesToFile(rule, file)) {
			continue;
		}

		let source;

		try {
			source = await readFile(join(root, file), "utf8");
		} catch {
			continue;
		}

		for (const pattern of rule.forbidden) {
			if (pattern.test(source)) {
				failures += 1;

				console.error(
					`Architecture violation: ${rule.name}\n` +
						`  file: ${relative(root, join(root, file))}\n` +
						`  pattern: ${pattern}`,
				);
			}
		}
	}
}

if (failures > 0) {
	console.error(`\nArchitecture check failed with ${failures} violation(s).`);
	process.exit(1);
}

console.log("Architecture checks passed.");
