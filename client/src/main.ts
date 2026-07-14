import { Game } from "./core/Game";
import { LobbyScene } from "./scenes/LobbyScene";
import "./style.css";

async function bootStrap() {
	const container = document.getElementById("app");
	if (!container) {
		throw new Error("#app element not found in index.html");
	}

	const game = await Game.create(container);

	await game.start(new LobbyScene(game));
}

bootStrap().catch(console.error);
