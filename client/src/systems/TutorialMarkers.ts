import { Container, Graphics, Text } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import { gridToScreen, TILE_WIDTH, TILE_HEIGHT } from "@/math/isoGridMath";
import { interpolatePolyline } from "@/entities/Mercenary";
import type {
	StaticActorSpec,
	TutorialUiPointerTarget,
} from "@/tutorial/tutorialTypes";

/**
 * Owns every purely-visual, tutorial-only element MapScene doesn't
 * need for real gameplay: the fixed-coord "move here" target marker,
 * the UI-pointer arrow, and static actor tokens. Guidance only, never
 * enforced — nothing here touches game state or turn logic.
 *
 * resolvePosition (passed into update, not stored) is the one seam
 * that stays external — only MapScene knows how to query its own
 * hud/hand/cardDrawQueue/playZone for a live screen position.
 * @author ShaAnder
 */
export class TutorialMarkers {
	readonly targetMarkerView = new Container();
	readonly uiPointerView = new Container();

	private targetElapsedMs = 0;
	private targetActive = false;

	private uiPointerElapsedMs = 0;
	private activeUiTarget: TutorialUiPointerTarget | null = null;

	private actorTokens: Map<string, Container> = new Map();
	private actorCoords: Map<string, RH.GridCoord> = new Map();

	constructor() {
		this.targetMarkerView.visible = false;
	}

	/**
	 * Glowing tile + bobbing downward arrow over a specific coord — a
	 * generic "move here" pointer any tutorial segment can request,
	 * not something built one-off for this scene.
	 */
	showTarget(coord: RH.GridCoord): void {
		const pos = gridToScreen(coord);
		this.targetMarkerView.removeChildren();
		this.targetMarkerView.x = pos.x;
		this.targetMarkerView.y = pos.y;

		const glow = new Graphics();
		glow.poly([
			0,
			-TILE_HEIGHT / 2,
			TILE_WIDTH / 2,
			0,
			0,
			TILE_HEIGHT / 2,
			-TILE_WIDTH / 2,
			0,
		]);
		glow.fill({ color: 0xffd700, alpha: 0.45 });
		glow.stroke({ width: 2, color: 0xffd700, alpha: 0.9 });
		this.targetMarkerView.addChild(glow);

		const arrow = new Graphics();
		arrow.poly([0, 0, 10, -16, -10, -16]);
		arrow.fill(0xffd700);
		arrow.y = -50;
		this.targetMarkerView.addChild(arrow);

		this.targetElapsedMs = 0;
		this.targetMarkerView.visible = true;
		this.targetActive = true;
	}

	hideTarget(): void {
		this.targetMarkerView.visible = false;
		this.targetActive = false;
	}

	/**
	 * Points a bobbing arrow at a screen-space UI element. `side` picks
	 * which direction the arrow sits and points from, chosen per-call
	 * to avoid overlapping whatever neighboring UI actually surrounds
	 * that target.
	 */
	showUiPointer(target: TutorialUiPointerTarget): void {
		this.activeUiTarget = target;
		this.uiPointerElapsedMs = 0;

		this.uiPointerView.removeChildren();
		const arrow = new Graphics();
		arrow.poly([0, 0, 10, -16, -10, -16]);
		arrow.fill(0xffd700);

		switch (target.side) {
			case "up":
				arrow.rotation = 0;
				break;
			case "down":
				arrow.rotation = Math.PI;
				break;
			case "left":
				arrow.rotation = -Math.PI / 2;
				break;
			case "right":
				arrow.rotation = Math.PI / 2;
				break;
		}

		this.uiPointerView.addChild(arrow);
	}

	hideUiPointer(): void {
		this.activeUiTarget = null;
		this.uiPointerView.visible = false;
	}

	/** Hides both markers (e.g. under a dialogue overlay), or restores whichever was logically still active. */
	setVisible(isVisible: boolean): void {
		this.uiPointerView.visible = isVisible && !!this.activeUiTarget;
		this.targetMarkerView.visible = isVisible && this.targetActive;
	}

	/**
	 * Per-frame bobbing animation for both markers. resolvePosition
	 * queries whatever live UI component the active target actually
	 * refers to — supplied fresh each call since only the caller knows
	 * how to reach its own hud/hand/cardDrawQueue/playZone.
	 */
	update(
		deltaTime: number,
		resolvePosition: (
			target: TutorialUiPointerTarget,
		) => { x: number; y: number } | null,
	): void {
		if (this.targetMarkerView.visible) {
			this.targetElapsedMs += (deltaTime / 60) * 1000;
			const t = this.targetElapsedMs;
			this.targetMarkerView.alpha = 0.6 + Math.abs(Math.sin(t * 0.004)) * 0.4;
			const arrow = this.targetMarkerView.children[1];
			if (arrow) arrow.y = -50 - Math.abs(Math.sin(t * 0.005)) * 8;
		}

		if (this.activeUiTarget) {
			const pos = resolvePosition(this.activeUiTarget);
			if (pos) {
				this.uiPointerElapsedMs += (deltaTime / 60) * 1000;
				const t = this.uiPointerElapsedMs;
				const bob = Math.abs(Math.sin(t * 0.005)) * 8;
				// actionButton (the only left/right consumer) is 130px
				// wide — 65px half-width — so a flat 40px offset landed
				// the arrow inside the button's own bounds. cardDrawStack
				// presents at 1.35x scale — genuinely taller than a normal
				// hand card, skipButton, or PlayZone — so 40px landed the
				// arrow inside that card specifically too.
				const isHorizontal =
					this.activeUiTarget.side === "left" ||
					this.activeUiTarget.side === "right";
				const isTallTarget = this.activeUiTarget.kind === "cardDrawStack";
				const offset = (isHorizontal ? 85 : isTallTarget ? 90 : 40) + bob;

				this.uiPointerView.visible = true;
				this.uiPointerView.alpha = 0.6 + Math.abs(Math.sin(t * 0.004)) * 0.4;

				switch (this.activeUiTarget.side) {
					case "up":
						this.uiPointerView.x = pos.x;
						this.uiPointerView.y = pos.y - offset;
						break;
					case "down":
						this.uiPointerView.x = pos.x;
						this.uiPointerView.y = pos.y + offset;
						break;
					case "left":
						this.uiPointerView.x = pos.x - offset;
						this.uiPointerView.y = pos.y;
						break;
					case "right":
						this.uiPointerView.x = pos.x + offset;
						this.uiPointerView.y = pos.y;
						break;
				}
			} else {
				// Target genuinely doesn't exist right now (e.g. pointing
				// at a submenu row while the submenu is closed, or the
				// card-draw stack once it's already been collected) —
				// hide rather than leave a stale arrow floating in place.
				this.uiPointerView.visible = false;
			}
		}
	}

	get actorCoordsList(): RH.GridCoord[] {
		return Array.from(this.actorCoords.values());
	}

	/**
	 * Purely visual, non-interactive tokens from the tutorial script's
	 * staticActors list — a narrator's on-map presence, a decorative
	 * "enemy" prop staged for tension. No PilotedMercenary, no
	 * TurnManager, no combat stats.
	 */
	spawnStaticActors(actors: StaticActorSpec[], layer: Container): void {
		for (const actor of actors) {
			const pos = gridToScreen(actor.coord);
			const token = new Container();
			token.x = pos.x;
			token.y = pos.y;

			const body = new Graphics();
			body.circle(0, -14, 16);
			body.fill(actor.color);
			body.stroke({ width: 2, color: 0x000000, alpha: 0.5 });
			token.addChild(body);

			const label = new Text({
				text: actor.label,
				style: { fill: 0xffffff, fontSize: 12, fontWeight: "bold" },
			});
			label.anchor.set(0.5, 1);
			label.y = -38;
			token.addChild(label);

			layer.addChild(token);
			this.actorTokens.set(actor.label, token);
			this.actorCoords.set(actor.label, actor.coord);
		}
	}

	/**
	 * Animates a static actor's token from its current screen position
	 * to destination — a simple, self-contained tween (not
	 * Mercenary.moveAlongPath's full animation system, which handles
	 * zone-of-control strikes mid-path that don't apply to a purely
	 * decorative token). Purely visual — no game state, no coord
	 * tracking, since static actors were never part of turn logic to
	 * begin with.
	 */
	moveStaticActor(
		label: string,
		destination: RH.GridCoord,
		grid: RH.Grid,
		durationMs = 900,
	): Promise<void> {
		const token = this.actorTokens.get(label);
		const currentCoord = this.actorCoords.get(label);
		if (!token || !currentCoord) return Promise.resolve();

		const range = RH.computeMovementRange(
			grid,
			currentCoord,
			grid.width + grid.height,
			new Set(),
		);
		const tilePath = RH.getPathTo(range, destination) ?? [destination];
		this.actorCoords.set(label, destination);

		// The whole path as one continuous polyline, not a queue of
		// separate per-tile tweens — interpolatePolyline (shared with
		// Mercenary's own movement) finds the correct position for a
		// SINGLE eased t across the entire route, so there's exactly one
		// ease-in at the start and one ease-out at the end, not a
		// stop-start-stop-start jitter at every intermediate tile.
		const points = [gridToScreen(currentCoord), ...tilePath.map(gridToScreen)];

		return new Promise((resolve) => {
			const start = performance.now();
			const frame = (): void => {
				const t = Math.min(1, (performance.now() - start) / durationMs);
				const eased = 1 - Math.pow(1 - t, 3);
				const pos = interpolatePolyline(points, eased);
				token.x = pos.x;
				token.y = pos.y;
				if (t < 1) {
					requestAnimationFrame(frame);
				} else {
					resolve();
				}
			};
			requestAnimationFrame(frame);
		});
	}
}
