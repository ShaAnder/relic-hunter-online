import { Game } from "./core/Game";
import { DungeonScene } from "./scenes/DungeonScene";
import "./style.css";

async function bootStrap() {
	const container = document.getElementById("app");
	if (!container) {
		throw new Error("#app element not found in index.html");
	}

	const game = await Game.create(container);
	await game.start(new DungeonScene(game));
}

bootStrap().catch(console.error);
