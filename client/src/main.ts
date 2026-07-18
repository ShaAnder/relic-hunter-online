import { Game } from "./core/Game";
import { MapScene } from "./scenes/MapScene";
import "./style.css";

async function bootStrap() {
	const container = document.getElementById("app");
	if (!container) {
		throw new Error("#app element not found in index.html");
	}

	const game = await Game.create(container);
	await game.start(new MapScene(game));
}

bootStrap().catch(console.error);
