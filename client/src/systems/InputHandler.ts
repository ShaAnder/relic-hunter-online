import { screenToGrid } from "../math/isoGridMath";
import type { GridCoord } from "@relic-hunter/shared";
import type { Container } from "pixi.js";

interface InputHandlerOptions {
	canvas: HTMLCanvasElement;
	boardContainer: Container;
	onEscape: () => void;
	onEndTurn: () => void;
	onRegenerate: () => void;
	/** Called when the Move button area is clicked. */
	onMoveButtonClick: () => void;
	/** Called when the board is clicked while move mode is active. */
	onBoardClick: () => void;
	onHover: (coord: GridCoord) => void;
	/** Returns true when move mode is currently active. */
	isMoveActive: () => boolean;
	/** Screen-space hit test for the Move button — delegates to MoveButton.hitTest(). */
	isMoveButtonHit: (screenX: number, screenY: number) => boolean;
}

/**
 * Attaches and detaches all keyboard and mouse listeners for DungeonScene.
 *
 * Translates raw DOM events into named game actions via callbacks so the scene
 * itself never touches event objects or coordinate math. The Move button hit
 * test is injected so this class stays decoupled from MoveButton directly.
 * Every scene that needs input wiring gets its own InputHandler — the callback
 * shape can differ while the attach/detach pattern stays consistent.
 */
export class InputHandler {
	constructor(private options: InputHandlerOptions) {}

	/** Wire up all listeners. Call from Scene.onEnter(). */
	attach(): void {
		window.addEventListener("keydown", this.handleKeyDown);
		this.options.canvas.addEventListener("click", this.handleClick);
		this.options.canvas.addEventListener("mousemove", this.handleMouseMove);
	}

	/** Remove all listeners. Call from Scene.onExit(). */
	detach(): void {
		window.removeEventListener("keydown", this.handleKeyDown);
		this.options.canvas.removeEventListener("click", this.handleClick);
		this.options.canvas.removeEventListener("mousemove", this.handleMouseMove);
	}

	// ---------- handlers ----------

	/** [Esc] cancel aim · [E] end turn · [R] regenerate. */
	private handleKeyDown = (event: KeyboardEvent): void => {
		switch (event.key) {
			case "Escape":
				this.options.onEscape();
				break;
			case "e":
			case "E":
				this.options.onEndTurn();
				break;
			case "r":
			case "R":
				this.options.onRegenerate();
				break;
		}
	};

	/**
	 * Route clicks to the Move button or, while in move mode, to a commit.
	 * Move button takes priority — a click on the button never also commits a move.
	 */
	private handleClick = (event: MouseEvent): void => {
		const { screenX, screenY } = this.getScreenPoint(event);

		if (this.options.isMoveButtonHit(screenX, screenY)) {
			this.options.onMoveButtonClick();
			return;
		}

		if (this.options.isMoveActive()) {
			this.options.onBoardClick();
		}
	};

	/** Feed hovered grid coords to the path preview while aiming. */
	private handleMouseMove = (event: MouseEvent): void => {
		if (!this.options.isMoveActive()) return;

		const { screenX, screenY } = this.getScreenPoint(event);
		const coord = this.screenPointToGrid(screenX, screenY);
		this.options.onHover(coord);
	};

	// ---------- coordinate helpers ----------

	/** Convert a mouse event to canvas-local screen coordinates. */
	private getScreenPoint(event: MouseEvent): {
		screenX: number;
		screenY: number;
	} {
		const rect = this.options.canvas.getBoundingClientRect();
		return {
			screenX: event.clientX - rect.left,
			screenY: event.clientY - rect.top,
		};
	}

	/** Convert canvas-local screen coordinates to a grid tile. */
	private screenPointToGrid(screenX: number, screenY: number): GridCoord {
		const localX =
			(screenX - this.options.boardContainer.x) /
			this.options.boardContainer.scale.x;
		const localY =
			(screenY - this.options.boardContainer.y) /
			this.options.boardContainer.scale.y;
		return screenToGrid(localX, localY);
	}
}
