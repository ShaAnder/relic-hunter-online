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
	},
	build: {
		target: "es2022",
		sourcemap: true,
	},
	// Only wire the filesystem writer in dev — never in a production build
	plugins: command === "serve" ? [saveCustomMapPlugin()] : [],
}));
