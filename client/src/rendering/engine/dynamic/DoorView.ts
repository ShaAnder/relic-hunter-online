import { Container, Graphics } from "pixi.js";
import type { DoorState } from "@relic-hunter/shared";
import type {
	CompiledDynamicBarrierAnchor,
	VisualQuad,
} from "../compiler/CompiledFloorVisual";
import { VisualMaterialRef } from "../materials/MaterialKey";
import { WorldPresentationCode } from "../presentation/WorldPresentation";
import { DynamicDepthController } from "./DynamicDepthController";

const WASH_COLOR = 0x14141e;
const WASH_ALPHA = 0.72;

interface BarrierStyle {
	color: number;
	alpha: number;
}

/**
 * Stateful Pixi view for one compiled Door segment.
 *
 * Geometry variants are compiled already. This class only chooses:
 *
 * - normal vs focused geometry,
 * - Hidden / Washed / Normal presentation,
 * - current DoorState presentation.
 */
export class DoorView {
	readonly view = new Container();
	private readonly graphics = new Graphics();
	private readonly depth = new DynamicDepthController();
	private state: DoorState = "closed";
	private presentation: WorldPresentationCode = WorldPresentationCode.Normal;
	private focused = false;

	constructor(private readonly anchor: CompiledDynamicBarrierAnchor) {
		this.view.label = `dynamic-door:${anchor.edgeId}`;
		this.view.addChild(this.graphics);
		this.depth.update(this.view, anchor.depth);
		this.redraw();
	}

	setState(state: DoorState): boolean {
		if (this.state === state) {
			return false;
		}
		this.state = state;
		this.redraw();
		return true;
	}

	applyPresentation(
		presentation: WorldPresentationCode,
		focused: boolean,
	): void {
		if (this.presentation === presentation && this.focused === focused) {
			return;
		}
		this.presentation = presentation;
		this.focused = focused;
		this.redraw();
	}

	destroy(): void {
		this.view.removeFromParent();
		this.graphics.destroy();
		this.view.destroy();
	}

	private redraw(): void {
		this.graphics.clear();
		if (this.presentation === WorldPresentationCode.Hidden) {
			this.view.visible = false;
			return;
		}
		this.view.visible = true;
		const face = this.focused
			? this.anchor.focusedFace
			: this.anchor.normalFace;
		const top = this.focused ? this.anchor.focusedTop : this.anchor.normalTop;
		this.drawSurface(face, this.anchor.faceMaterial, this.stateOpacity());
		if (top && this.anchor.topMaterial) {
			this.drawSurface(top, this.anchor.topMaterial, this.stateOpacity());
		}
	}

	private drawSurface(
		quad: VisualQuad,
		material: VisualMaterialRef,
		stateOpacity: number,
	): void {
		const style = this.barrierStyle(material);
		const color =
			this.presentation === WorldPresentationCode.Washed
				? mixColor(style.color, WASH_COLOR, WASH_ALPHA)
				: style.color;
		this.graphics.poly(flattenQuad(quad));
		this.graphics.fill({
			color,
			alpha: style.alpha * stateOpacity,
		});
	}

	private barrierStyle(material: VisualMaterialRef): BarrierStyle {
		if (material.kind !== "barrier") {
			throw new Error(
				`DoorView: expected barrier material, received ${material.kind}`,
			);
		}
		return {
			color: material.fallbackColor,
			alpha: material.alpha,
		};
	}

	/**
	 * Placeholder state treatment until authored door animation arrives.
	 *
	 * Crucially, changing this state redraws only this DoorView. It does not
	 * rebuild neighboring static wall geometry.
	 */
	private stateOpacity(): number {
		switch (this.state) {
			case "closed":
				return 1;
			case "opening":
			case "closing":
				return 0.65;
			case "open":
				return 0.18;
		}
	}
}

function flattenQuad(quad: VisualQuad): number[] {
	return [
		quad[0].x,
		quad[0].y,

		quad[1].x,
		quad[1].y,

		quad[2].x,
		quad[2].y,

		quad[3].x,
		quad[3].y,
	];
}

function mixColor(from: number, to: number, t: number): number {
	const clamped = Math.max(0, Math.min(1, t));
	const fromR = (from >> 16) & 0xff;
	const fromG = (from >> 8) & 0xff;
	const fromB = from & 0xff;
	const toR = (to >> 16) & 0xff;
	const toG = (to >> 8) & 0xff;
	const toB = to & 0xff;
	const r = Math.round(fromR + (toR - fromR) * clamped);
	const g = Math.round(fromG + (toG - fromG) * clamped);
	const b = Math.round(fromB + (toB - fromB) * clamped);
	return (r << 16) | (g << 8) | b;
}
