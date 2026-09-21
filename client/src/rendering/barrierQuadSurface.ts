import {
	Container,
	Graphics,
	MeshSimple,
	type Texture,
} from "pixi.js";

export type BarrierSurfacePoint = Readonly<{
	x: number;
	y: number;
}>;

export type BarrierSurfaceQuad = readonly [
	BarrierSurfacePoint,
	BarrierSurfacePoint,
	BarrierSurfacePoint,
	BarrierSurfacePoint,
];

export type BarrierSurfaceUvs = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

/**
 * Adds one four-corner surface with explicit UVs.
 *
 * This is the important difference from Graphics.fill({ texture,
 * textureSpace: "local" }): the texture follows the projected wall
 * surface rather than being fitted to the polygon's rectangular bounds.
 */
export function addBarrierQuadSurface(
	parent: Container,
	quad: BarrierSurfaceQuad,
	texture: Texture | undefined,
	fallbackColor: number,
	alpha: number,
	uvs: BarrierSurfaceUvs = [
		0, 0,
		1, 0,
		1, 1,
		0, 1,
	],
): void {
	if (!texture) {
		const g = new Graphics();
		g.poly([
			quad[0].x,
			quad[0].y,
			quad[1].x,
			quad[1].y,
			quad[2].x,
			quad[2].y,
			quad[3].x,
			quad[3].y,
		]);
		g.fill({
			color: fallbackColor,
			alpha,
		});
		parent.addChild(g);
		return;
	}

	const mesh = new MeshSimple({
		texture,
		vertices: new Float32Array([
			quad[0].x,
			quad[0].y,
			quad[1].x,
			quad[1].y,
			quad[2].x,
			quad[2].y,
			quad[3].x,
			quad[3].y,
		]),
		uvs: new Float32Array(uvs),
		indices: new Uint32Array([
			0, 1, 2,
			0, 2, 3,
		]),
	});

	mesh.autoUpdate = false;
	mesh.alpha = alpha;
	parent.addChild(mesh);
}

export function addBarrierQuadOverlay(
	parent: Container,
	quad: BarrierSurfaceQuad,
	color: number,
	alpha: number,
): void {
	const g = new Graphics();
	g.poly([
		quad[0].x,
		quad[0].y,
		quad[1].x,
		quad[1].y,
		quad[2].x,
		quad[2].y,
		quad[3].x,
		quad[3].y,
	]);
	g.fill({ color, alpha });
	parent.addChild(g);
}
