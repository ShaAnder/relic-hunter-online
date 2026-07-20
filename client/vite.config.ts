import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"@relic-hunter/shared": path.resolve(__dirname, "../shared/index.ts"),
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
});
