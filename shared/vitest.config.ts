import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// shared must remain runnable without a browser environment at all —
		// that's the whole point of the client/shared boundary architecture.md
		// establishes.
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
