/**
 * A HUD surface that can claim wheel/drag gestures over itself. The
 * camera never checks panel geometry directly — it only finds out a
 * surface claimed the gesture when routeWheel/findOwnerAt says so.
 * @author ShaAnder
 */
export interface ScrollSurface {
	hitTest(screenX: number, screenY: number): boolean;
	handleWheel(deltaY: number): boolean;
	handleDrag(deltaX: number, deltaY: number): boolean;
}

/**
 * The single arbiter of wheel/drag ownership between HUD panels and
 * the camera. Deliberately tiny — a hit-test list and two lookups,
 * not a general input framework.
 * @author ShaAnder
 */
export class GestureRouter {
	private surfaces: ScrollSurface[] = [];

	register(surface: ScrollSurface): void {
		this.surfaces.push(surface);
	}

	/** The most specific surface under (x, y), or null if the camera/map owns this point. */
	findOwnerAt(screenX: number, screenY: number): ScrollSurface | null {
		for (const surface of this.surfaces) {
			if (surface.hitTest(screenX, screenY)) return surface;
		}
		return null;
	}

	/** Routes a wheel event by position — true if a surface consumed it, false if the camera should. */
	routeWheel(screenX: number, screenY: number, deltaY: number): boolean {
		const owner = this.findOwnerAt(screenX, screenY);
		return owner ? owner.handleWheel(deltaY) : false;
	}
}
