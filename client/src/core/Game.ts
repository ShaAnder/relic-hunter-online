import { Application } from "pixi.js";
import { SceneManager } from "./SceneManager";
import type { Scene } from "./Scene";
import { GameSession } from "./GameSession";

/**
 * Central controller for the PixiJS client.
 *
 * This class bootstraps the rendering engine, manages the scene system,
 * and handles global concerns like resizing and the game loop.
 *
 * It is designed to be instantiated once at startup and then largely left alone.
 * Most game logic should live in `Scene` subclasses or in the `shared` package.
 *
 * ### Key Characteristics:
 * - Uses an async factory pattern (`static create()`) due to PixiJS v8 requirements.
 * - Owns a single `SceneManager` instance for the lifetime of the application.
 * - Delegates all per-frame logic to the active scene via `SceneManager`.
 *
 * @see SceneManager
 * @see Scene
 */
export class Game {
	// we make readonly as once game is created we never want to replace them, but still allow access
	readonly app: Application;
	readonly sceneManager: SceneManager;
	readonly session = new GameSession();

	/**
	 * Private constructor to enforce the use of the async factory method `Game.create()`.
	 *
	 * PixiJS v8's `Application.init()` is asynchronous, so we cannot fully construct
	 * a usable Game object using a normal constructor. Making the constructor private
	 * prevents developers from accidentally creating a half-initialized Game instance.
	 */
	private constructor(app: Application) {
		this.app = app;
		this.sceneManager = new SceneManager(app.stage);

		// main game loop
		this.app.ticker.add((ticker) => {
			this.sceneManager.update(ticker.deltaTime);
		});

		// handle browser window resizing
		window.addEventListener("resize", () => this.handleResize());
	}

	/**
	 * Asynchronously creates and initializes a new Game instance.
	 *
	 * This is the proper way to instantiate `Game` because `Application.init()`
	 * must be awaited in PixiJS v8.
	 *
	 * @param container - The HTML element that the Pixi canvas should be appended to.
	 */
	static async create(container: HTMLElement): Promise<Game> {
		const app = new Application();

		await app.init({
			resizeTo: container,
			backgroundColor: 0x1a1a1a,
			antialias: true,
		});

		container.appendChild(app.canvas);

		return new Game(app);
	}

	/**
	 * Starts the game by activating the initial scene.
	 * This is usually called right after `Game.create()`.
	 */
	async start(initialScene: Scene): Promise<void> {
		await this.sceneManager.changeScene(initialScene);
	}

	/**
	 * Internal method that forwards resize events to the SceneManager.
	 */
	private handleResize(): void {
		this.sceneManager.onResize(this.app.screen.width, this.app.screen.height);
	}
}
