import { Game } from "./core/game/Game";
import { MainMenuScene } from "@/scenes/MainMenuScene";
import "@/style.css";

async function bootStrap() {
	const container = document.getElementById("app");
	if (!container) {
		throw new Error("#app element not found in index.html");
	}

	const game = await Game.create(container);
	await game.start(new MainMenuScene(game));
}

bootStrap().catch(console.error);
