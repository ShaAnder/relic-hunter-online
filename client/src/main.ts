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

/** Real fullscreen, unlike tryLockLandscape — but only fires from an actual tap, browsers block it otherwise. Not supported on iOS Safari at all; the button quietly does nothing there. */
function setupFullscreenButton(): void {
	const btn = document.getElementById("fullscreen-btn");
	if (!btn) return;

	btn.addEventListener("click", () => {
		void document.documentElement.requestFullscreen?.().then(() => {
			btn.style.display = "none";
		});
	});

	document.addEventListener("fullscreenchange", () => {
		if (!document.fullscreenElement) {
			btn.style.display = "";
		}
	});
}

async function bootStrap() {
	const container = document.getElementById("app");
	if (!container) {
		throw new Error("#app element not found in index.html");
	}

	tryLockLandscape();
	setupFullscreenButton();

	const game = await Game.create(container);
	await game.start(new MainMenuScene(game));
}

bootStrap().catch(console.error);
