import type { Plugin } from "vite";
import { promises as fs } from "node:fs";
import path from "node:path";

const CUSTOM_MAPS_DIR = path.resolve(
	__dirname,
	"../../shared/src/world/maps/custom",
);
const REGISTRY_PATH = path.join(CUSTOM_MAPS_DIR, "index.ts");

interface SaveRequestBody {
	name: string;
	blueprint: number[][];
}

/** Turns an arbitrary map name into a safe TS identifier/filename — letters, digits, underscore only, never starting with a digit. */
function toSafeIdentifier(name: string): string {
	const cleaned = name
		.trim()
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	const withLeadingLetter = /^[0-9]/.test(cleaned) ? `Map_${cleaned}` : cleaned;
	return withLeadingLetter || "UnnamedMap";
}

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(chunk as Buffer);
	}
	const raw = Buffer.concat(chunks).toString("utf-8");
	return raw ? JSON.parse(raw) : {};
}

async function listMapFiles(): Promise<string[]> {
	try {
		const entries = await fs.readdir(CUSTOM_MAPS_DIR);
		return entries.filter((f) => f.endsWith(".ts") && f !== "index.ts");
	} catch {
		return [];
	}
}

/**
 * Regenerates custom/index.ts from scratch by scanning every map file
 * actually present in the folder — the registry is always a direct
 * reflection of what's on disk, never a separately-maintained list
 * that could drift out of sync with it.
 */
async function regenerateRegistry(): Promise<void> {
	const files = await listMapFiles();
	const entries: { identifier: string; moduleName: string }[] = [];

	for (const file of files) {
		const moduleName = file.replace(/\.ts$/, "");
		entries.push({ identifier: moduleName, moduleName });
	}

	const imports = entries
		.map((e) => `import { ${e.identifier}_NAME, ${e.identifier}_BLUEPRINT } from "./${e.moduleName}";`)
		.join("\n");

	const listEntries = entries
		.map((e) => `\t{ name: ${e.identifier}_NAME, blueprint: ${e.identifier}_BLUEPRINT },`)
		.join("\n");

	const content = `/**
 * Registry of every custom map currently saved to disk under
 * shared/src/world/maps/custom/ — regenerated automatically by the
 * local save-custom-map dev endpoint (see
 * client/vite-plugins/saveCustomMap.ts) every time a map is saved or
 * deleted. Never edit this file by hand; it will be overwritten.
 */
${imports}

export interface CustomMapEntry {
	name: string;
	blueprint: number[][];
}

export const CUSTOM_MAPS: CustomMapEntry[] = [
${listEntries}
];
`;

	await fs.writeFile(REGISTRY_PATH, content, "utf-8");
}

function toBlueprintFileContent(safeId: string, displayName: string, blueprint: number[][]): string {
	const rows = blueprint.map((row) => `\t[${row.join(", ")}],`).join("\n");
	return `/**
 * Custom map saved from the in-game Map Creator.
 * Double-resolution format — compiles directly with compileEdgeMap()
 * from this package. See MapCreatorScene.ts for the code scheme.
 */
export const ${safeId}_NAME = ${JSON.stringify(displayName)};
export const ${safeId}_BLUEPRINT: number[][] = [
${rows}
];
`;
}

/**
 * Dev-only Vite plugin: handles saving/deleting custom maps as real
 * files under shared/src/world/maps/custom/, via a middleware running
 * inside the same `npm run dev` process — no separate server to
 * start. The browser itself never touches the filesystem (it can't —
 * that's a hard sandboxing boundary, not a missing feature); it POSTs
 * the blueprint to this endpoint, and this Node-side code — which
 * runs as part of the Vite dev server, not in the browser — does the
 * actual write.
 *
 * Dev-only deliberately: this plugin is never included in a
 * production build (see vite.config.ts, only added when
 * `command === "serve"`), since a shipped game has no local
 * filesystem to write to and this whole approach is specific to the
 * local-development workflow described in the project's own EdgeGrid
 * planning doc.
 */
export function saveCustomMapPlugin(): Plugin {
	return {
		name: "save-custom-map",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (req.url === "/api/save-custom-map" && req.method === "POST") {
					try {
						const body = (await readJsonBody(req)) as SaveRequestBody;
						if (!body.name || !Array.isArray(body.blueprint)) {
							res.statusCode = 400;
							res.end(JSON.stringify({ error: "name and blueprint are required" }));
							return;
						}

						await fs.mkdir(CUSTOM_MAPS_DIR, { recursive: true });
						const safeId = toSafeIdentifier(body.name);
						const filePath = path.join(CUSTOM_MAPS_DIR, `${safeId}.ts`);
						await fs.writeFile(
							filePath,
							toBlueprintFileContent(safeId, body.name, body.blueprint),
							"utf-8",
						);
						await regenerateRegistry();

						res.statusCode = 200;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ ok: true, file: `${safeId}.ts` }));
					} catch (err) {
						res.statusCode = 500;
						res.end(JSON.stringify({ error: String(err) }));
					}
					return;
				}

				if (req.url?.startsWith("/api/delete-custom-map/") && req.method === "DELETE") {
					try {
						const safeId = decodeURIComponent(req.url.slice("/api/delete-custom-map/".length));
						const filePath = path.join(CUSTOM_MAPS_DIR, `${safeId}.ts`);
						await fs.rm(filePath, { force: true });
						await regenerateRegistry();

						res.statusCode = 200;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ ok: true }));
					} catch (err) {
						res.statusCode = 500;
						res.end(JSON.stringify({ error: String(err) }));
					}
					return;
				}

				next();
			});
		},
	};
}
