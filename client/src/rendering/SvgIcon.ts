import { Assets, Sprite } from "pixi.js";

/**
 * Loads an SVG as a texture-backed Sprite, centered on its own origin
 * and optionally scaled so its longer side matches `size`. Deliberately
 * NOT using Pixi's Graphics.svg() vector parser — it crashes on real
 * icon files (nested <g>/style attributes), throwing inside Pixi's own
 * internal parseSVGDefinitions. Texture loading uses Pixi's separate,
 * more mature image pipeline and never touches that code path.
 *
 * Async — Assets.load is asynchronous. Import the icon WITHOUT the
 * `?raw` suffix (a plain `import iconUrl from "./x.svg"`).
 *
 * @param svgUrl - the icon's asset URL
 * @param size - target size for the longer dimension; omit to keep native size
 * @author ShaAnder
 */
export async function loadIconSprite(
	svgUrl: string,
	size?: number,
): Promise<Sprite> {
	const texture = await Assets.load(svgUrl);
	const sprite = new Sprite(texture);
	sprite.anchor.set(0.5);

	if (size) {
		const largest = Math.max(texture.width, texture.height);
		if (largest > 0) {
			sprite.scale.set(size / largest);
		}
	}

	return sprite;
}
