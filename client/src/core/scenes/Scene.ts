import { Container } from "pixi.js";

// Scene interface that is used for every screen in the game
export interface Scene {
	// The root container this scene renders into, SceneManager cleans this as needed
	readonly view: Container;

	// Called once when scene is being replaced, we want to do either void or a promise
	// to ensure that we're not awaiting unnessecarily
	onEnter(): void | Promise<void>;

	// we use on exit as a cleanup, no promise needed as no async, serves solely to
	// cleanup listeners stop timers ect
	onExit(): void;

	// using timer / number for updating frames, only needs to react to time, not manipulate
	// pixijs ticker object not needed
	update(deltaTime: number): void;

	// use 2 args, width and height so we can accurately reposition elements on resize
	// small cheap syncronous action
	onResize(width: number, height: number): void;
}
