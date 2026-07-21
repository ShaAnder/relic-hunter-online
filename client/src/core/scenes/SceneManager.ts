import { Container } from "pixi.js";
import type { Scene } from "./Scene";

/**
 * Orchestrates scene transitions and lifecycle management for the game.
 *
 * This class acts as a controller that swaps between different game screens
 * (e.g. `LobbyScene`, `DungeonScene`, `CombatScene`) while maintaining
 * consistent behavior around setup, teardown, and rendering.
 *
 * ### Key Responsibilities:
 * - Handles asynchronous scene entry (`onEnter`) safely.
 * - Prevents overlapping scene transitions using a generation counter.
 * - Ensures the previous scene remains visible until the new scene is ready.
 * - Blocks per-frame updates (`update` / `onResize`) during transitions.
 *
 * ### Design Notes:
 * - All game-specific logic lives inside individual `Scene` implementations.
 * - The manager is intentionally "dumb" — it only manages *when* and *how*
 *   scenes are added/removed from the Pixi stage.
 * - Designed to work unchanged when moving from client-only scenes (Phase 1)
 *   to server-driven scenes (Phase 3+).
 *
 * @see Scene
 */
export class SceneManager {
	// The Pixi stage we add/remove scene views from. Kept private so only this class can mutate it.
	private stage: Container;
	// The currently active scene. Null when no scene is active.
	private currentScene: Scene | null = null;
	/**
	 * Used to detect and ignore stale async transitions.
	 * Every call to changeScene() increments this. If a previous transition's ID
	 * no longer matches when it finishes, we know a newer transition has started.
	 */
	private transitionId = 0;
	// When true, prevents update() and onResize() from running.
	private isTransitioning = false;

	constructor(stage: Container) {
		this.stage = stage;
	}

	/**
	 * Transitions from the current scene to a new one.
	 *
	 * Key safety behaviors:
	 * - The old scene is only removed *after* the new scene successfully enters.
	 * - If another changeScene() call happens while this one is loading, this transition is cancelled.
	 * - update() and onResize() are blocked during the transition.
	 */
	async changeScene(next: Scene): Promise<void> {
		const myTransitionId = ++this.transitionId;
		const previousScene = this.currentScene;

		this.isTransitioning = true;

		// Attempt to initialize the new scene first. We do this *before* removing
		// the old scene so we have something to fall back to on failure.
		try {
			await next.onEnter();
		} catch (err) {
			console.error("Scene failed to enter:", err);
			this.isTransitioning = false;
			throw err; // Let the caller handle the error (e.g. show error screen)
		}

		// If a newer changeScene() call started while we were awaiting onEnter(),
		if (myTransitionId !== this.transitionId) {
			next.onExit();
			this.isTransitioning = false;
			return;
		}

		// Only now is it safe to remove the previous scene
		if (previousScene) {
			previousScene.onExit();
			this.stage.removeChild(previousScene.view);
		}

		this.currentScene = next;
		this.stage.addChild(next.view);
		this.isTransitioning = false;
	}

	/**
	 * Called every frame by the Game class.
	 * Only forwards the call if we're not currently transitioning between scenes.
	 */
	update(deltaTime: number): void {
		if (!this.isTransitioning && this.currentScene) {
			this.currentScene.update(deltaTime);
		}
	}

	/**
	 * Called when the window is resized.
	 * Only forwards the call if we're not currently transitioning.
	 */
	onResize(width: number, height: number): void {
		if (!this.isTransitioning && this.currentScene) {
			this.currentScene.onResize(width, height);
		}
	}
}
