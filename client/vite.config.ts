import { defineConfig } from "vite";
import path from "node:path";
import { saveCustomMapPlugin } from "./vite-plugins/saveCustomMap";

export default defineConfig(({ command }) => ({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"@relic-hunter/shared": path.resolve(__dirname, "../shared/src/index.ts"),
		},
	},
	server: {
		port: 5173,
		host: true,
		watch: {
			// The save-custom-map endpoint writes new/changed files here
			// on every Map Creator save or delete. Vite has no HMR
			// boundary for a brand-new module entering the dependency
			// graph (there's no HMR setup anywhere in this game's
			// architecture, which is normal - a live game with
			// persistent session/scene state isn't a good fit for
			// hot-swapping module code underneath it), so it falls back
			// to a full page reload on every single save - jarring, and
			// unnecessary.
			ignored: ["**/shared/src/world/maps/custom/**"],
		},
	},
	build: {
		target: "es2022",
		sourcemap: true,
	},
	// Only wire the filesystem writer in dev — never in a production build
	plugins: command === "serve" ? [saveCustomMapPlugin()] : [],
}));
