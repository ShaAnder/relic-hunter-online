import { TILE_HEIGHT } from "@/math/isoGridMath";
import { barrierRenderProfileFor } from "@/rendering/barrierRenderProfile";
import type {
	CompiledConnectorVisual,
	VisualQuad,
	VisualUvs,
	VisualPoint,
} from "../compiler/CompiledFloorVisual";
import type { VisualMaterialRef } from "../materials/MaterialKey";

export type ConnectorSurfaceSlot = "left" | "right" | "top";

export interface ConnectorSurfaceGeometry {
	slot: ConnectorSurfaceSlot;
	quad: VisualQuad;
	uvs: VisualUvs;
	material: VisualMaterialRef;
}

/**
 * Expand one compiler-level connector record into renderable quads for one
 * resolved height.
 *
 * This stays Pixi-free. The runtime renderer decides how those quads batch.
 */
export function compileConnectorSurfaces(
	connector: CompiledConnectorVisual,
	height: number,
): readonly ConnectorSurfaceGeometry[] {
	const profile = barrierRenderProfileFor(connector.barrier);
	const { x: cx, y: cy } = connector.base;
	const foundationDrop = Math.max(0, connector.foundationBottomY - cy);
	const half = profile.connectorHalfPx;
	const top: VisualPoint = {
		x: cx,
		y: cy - half,
	};
	const right: VisualPoint = {
		x: cx + half,
		y: cy,
	};
	const bottom: VisualPoint = {
		x: cx,
		y: cy + half,
	};
	const left: VisualPoint = {
		x: cx - half,
		y: cy,
	};
	const lowerRight: VisualPoint = {
		x: right.x,
		y: right.y + foundationDrop,
	};
	const lowerBottom: VisualPoint = {
		x: bottom.x,
		y: bottom.y + foundationDrop,
	};
	const lowerLeft: VisualPoint = {
		x: left.x,
		y: left.y + foundationDrop,
	};

	const up = (point: VisualPoint): VisualPoint => ({
		x: point.x,
		y: point.y - height,
	});

	const topU = up(top);
	const rightU = up(right);
	const bottomU = up(bottom);
	const leftU = up(left);
	const leftFace: VisualQuad = [leftU, bottomU, lowerBottom, lowerLeft];
	const rightFace: VisualQuad = [bottomU, rightU, lowerRight, lowerBottom];
	const topFace: VisualQuad = [topU, rightU, bottomU, leftU];
	const connectorV =
		(Math.max(1, height + foundationDrop) / TILE_HEIGHT) *
		profile.faceUvPerStorey;
	const faceUvs: VisualUvs = [0, 0, 1, 0, 1, connectorV, 0, connectorV];
	const topUvs: VisualUvs = [0, 0, 1, 0, 1, 1, 0, 1];

	const result: ConnectorSurfaceGeometry[] = [
		{
			slot: "left",
			quad: leftFace,
			uvs: faceUvs,
			material: connector.leftMaterial,
		},

		{
			slot: "right",
			quad: rightFace,
			uvs: faceUvs,
			material: connector.rightMaterial,
		},
	];

	if (connector.topMaterial) {
		result.push({
			slot: "top",
			quad: topFace,
			uvs: topUvs,
			material: connector.topMaterial,
		});
	}
	return result;
}
