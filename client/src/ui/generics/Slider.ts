import { Container, Graphics, type FederatedPointerEvent } from "pixi.js";

export interface SliderConfig {
	width?: number;
	height?: number;
	trackColor?: number;
	fillColor?: number;
	handleColor?: number;
	/** starting value 0-1 */
	value?: number;
	onChange?: (value: number) => void;
}

/**
 * Generic horizontal slider, 0–1. Click-to-jump or drag the handle.
 * Value math only — callers decide what 0–1 actually means (a volume
 * level, a percentage, anything else).
 */
export class Slider {
	readonly view = new Container();
	private track = new Graphics();
	private fill = new Graphics();
	private handle = new Graphics();
	private config: Required<SliderConfig>;
	private value: number;

	/**
	 * stage is needed for the same reason Hand.ts's card-drag needs it:
	 * once a drag starts, the pointer routinely moves outside this
	 * slider's own small hit area (past either end, above, below)
	 * while still logically "dragging."
	 */
	constructor(
		private stage: Container,
		config: SliderConfig = {},
	) {
		this.config = {
			width: 200,
			height: 8,
			trackColor: 0x2a2a2a,
			fillColor: 0x4a9eff,
			handleColor: 0xffffff,
			value: 1,
			onChange: () => {},
			...config,
		};
		this.value = clamp01(this.config.value);

		this.view.addChild(this.track);
		this.view.addChild(this.fill);
		this.view.addChild(this.handle);

		this.redraw();
		this.setupEvents();
	}

	private redraw(): void {
		const { width, height, trackColor, fillColor, handleColor } = this.config;

		this.track.clear();
		this.track.roundRect(0, 0, width, height, height / 2);
		this.track.fill(trackColor);

		const fillWidth = width * this.value;
		this.fill.clear();
		if (fillWidth > 0) {
			this.fill.roundRect(0, 0, fillWidth, height, height / 2);
			this.fill.fill(fillColor);
		}

		// Handle is a circle centered on the fill's leading edge,
		// vertically centered on the track regardless of track height.
		const handleRadius = height;
		this.handle.clear();
		this.handle.circle(0, 0, handleRadius);
		this.handle.fill(handleColor);
		this.handle.stroke({ width: 2, color: 0x000000, alpha: 0.4 });
		this.handle.x = fillWidth;
		this.handle.y = height / 2;
	}

	/**
	 * Both click-to-jump and drag funnel through this one conversion:
	 * take a pointer's global position, convert to this slider's own
	 * local space
	 */
	private setValueFromGlobal(globalX: number, globalY: number): void {
		const local = this.view.toLocal({ x: globalX, y: globalY });
		const clampedX = Math.max(0, Math.min(this.config.width, local.x));
		const next = clamp01(clampedX / this.config.width);
		if (next === this.value) return;
		this.value = next;
		this.redraw();
		this.config.onChange(this.value);
	}

	private onDragMove = (event: FederatedPointerEvent): void => {
		this.setValueFromGlobal(event.global.x, event.global.y);
	};

	private onDragEnd = (): void => {
		this.stage.off("pointermove", this.onDragMove);
		this.stage.off("pointerup", this.onDragEnd);
		this.stage.off("pointerupoutside", this.onDragEnd);
	};

	private setupEvents(): void {
		this.view.eventMode = "static";
		this.view.cursor = "pointer";

		// pointerdown jumps straight to wherever was clicked (no need
		// to grab the handle specifically), then starts listening on
		// the stage for the rest of the drag
		this.view.on("pointerdown", (e: FederatedPointerEvent) => {
			this.setValueFromGlobal(e.global.x, e.global.y);
			this.stage.on("pointermove", this.onDragMove);
			this.stage.on("pointerup", this.onDragEnd);
			this.stage.on("pointerupoutside", this.onDragEnd);
		});
	}

	getValue(): number {
		return this.value;
	}

	/** Set programmatically (e.g. loading a saved setting) without firing
	 * onChange — this is "sync the display," not "the user changed something."
	 */
	setValue(value: number): void {
		this.value = clamp01(value);
		this.redraw();
	}
}

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}
