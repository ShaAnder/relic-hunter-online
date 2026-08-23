import { Game } from "./core/game/Game";
import { MainMenuScene } from "@/scenes/MainMenuScene";
import "@/style.css";

/** Best-effort only — no effect on iOS Safari, and only works in fullscreen on the browsers that do support it. The CSS rotate-prompt is what actually guarantees landscape everywhere. */
function tryLockLandscape(): void {
	const orientation = screen.orientation as ScreenOrientation & {
		lock?: (o: string) => Promise<void>;
	};
	orientation.lock?.("landscape").catch(() => {
		// Unsupported or not in fullscreen — the CSS rotate-prompt is the real fallback.
	});
}

async function bootStrap() {
	const container = document.getElementById("app");
	if (!container) {
		throw new Error("#app element not found in index.html");
	}

	tryLockLandscape();

	const game = await Game.create(container);
	await game.start(new MainMenuScene(game));
}

bootStrap().catch(console.error);
