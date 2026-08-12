import { Container, Graphics, Sprite } from "pixi.js";
import type { TurnManager } from "@/systems/TurnManager";
import { loadIconSprite } from "@/rendering/SvgIcon";
import moveSvgUrl from "@/assets/icons/move.svg";
import actionsSvgUrl from "@/assets/icons/actions.svg";
import endTurnSvgUrl from "@/assets/icons/endTurn.svg";
import attackSvgUrl from "@/assets/icons/attack.svg";
import restSvgUrl from "@/assets/icons/rest.svg";
import engageSvgUrl from "@/assets/icons/engage.svg";
import { pointInCircle } from "@/rendering/HitTest";

export type ButtonAction =
	| "move"
	| "attack"
	| "rest"
	| "disengage"
	| "endTurn"
	| null;

const HUB_RADIUS = 25;
const NODE_RADIUS = 25;
const INNER_RING_R = 100; // was 80, widened to match bigger NODE_RADIUS
const OUTER_RING_R = 169; // was 144, widened to match bigger NODE_RADIUS

const INNER_EASE_SPEED = 1.0; // px per ms — fast/snappy, was miscalibrated ~100x too slow before
const OUTER_ANGLE_EASE_SPEED = 0.018; // radians per ms — same fast feel, angular instead of linear

const DEG = Math.PI / 180;
const HIDDEN_ANGLE = 90 * DEG; // straight down — off-canvas below the hub when collapsed

const INNER_ANGLES = {
	move: 270 * DEG,
	actionHub: 230 * DEG,
	endTurn: 190 * DEG,
};
const OUTER_ANGLES = {
	disengage: 260 * DEG,
	rest: 230 * DEG,
	attack: 200 * DEG,
};

interface InnerNode {
	key: string;
	action: ButtonAction;
	angle: number;
	enabled: boolean;
	container: Container;
	bg: Graphics;
}

interface OuterNode {
	key: string;
	action: ButtonAction;
	restAngle: number; // where it settles when the ring is open
	currentAngle: number;
	targetAngle: number;
	enabled: boolean;
	container: Container;
	bg: Graphics;
}

/**
 * Radial action wheel. Hub is permanently fixed, never moves. Inner ring
 * eases its radius open/closed (fast). Outer ring stays at constant
 * radius and instead rotates each node's angle in from a shared "hidden"
 * position straight below the hub, fanning out to individual resting
 * angles as it opens — a wheel swinging up from the bottom, not nodes
 * growing outward from a point.
 * @author ShaAnder
 */
export class RadialActionWheel {
	readonly view = new Container();

	private hub = new Container();
	private hubBg = new Graphics();
	private arrowIcon = new Graphics();

	private innerNodes: InnerNode[] = [];
	private outerNodes: OuterNode[] = [];

	private innerExpanded = true;
	private outerOpen = false;

	// Inner ring's shared animated radius (all 3 nodes move together)
	private innerRadius = INNER_RING_R;
	private innerRadiusTarget = INNER_RING_R;

	constructor() {
		this.buildHub();
		this.buildInnerRing();
		this.buildOuterRing();
	}

	layout(screenWidth: number, screenHeight: number): void {
		this.view.x = screenWidth - 40;
		this.view.y = screenHeight - 40;
	}

	update(deltaTime: number): void {
		const deltaMs = (deltaTime / 60) * 1000;

		if (this.innerRadius !== this.innerRadiusTarget) {
			const step = INNER_EASE_SPEED * deltaMs;
			this.innerRadius =
				this.innerRadius < this.innerRadiusTarget
					? Math.min(this.innerRadiusTarget, this.innerRadius + step)
					: Math.max(this.innerRadiusTarget, this.innerRadius - step);
			this.applyInnerRadius(this.innerRadius);
		}

		const angleStep = OUTER_ANGLE_EASE_SPEED * deltaMs;
		for (const node of this.outerNodes) {
			if (node.currentAngle === node.targetAngle) continue;
			node.currentAngle =
				node.currentAngle < node.targetAngle
					? Math.min(node.targetAngle, node.currentAngle + angleStep)
					: Math.max(node.targetAngle, node.currentAngle - angleStep);
			node.container.x = OUTER_RING_R * Math.cos(node.currentAngle);
			node.container.y = OUTER_RING_R * Math.sin(node.currentAngle);
			node.container.visible =
				this.outerOpen || node.currentAngle !== HIDDEN_ANGLE;
		}
	}

	sync(tm: TurnManager): void {
		this.setNodeEnabled("move", tm.canMove);
		this.setNodeEnabled("attack", tm.canAttack);
		this.setNodeEnabled("rest", tm.canRest);
		this.setNodeEnabled("disengage", tm.canDisengage);
	}

	/** Collapses the outer ring only — matches the old ActionButton.closeMenu() role. */
	closeMenu(): void {
		this.outerOpen = false;
		for (const node of this.outerNodes) node.targetAngle = HIDDEN_ANGLE;
	}

	setMoveActive(active: boolean): void {
		const move = this.innerNodes.find((n) => n.key === "move");
		if (move) this.redrawInnerNode(move, active ? 0x4a9eff : 0x2a2a2a);
	}

	handleClick(screenX: number, screenY: number): ButtonAction {
		const localX = screenX - this.view.x;
		const localY = screenY - this.view.y;

		if (pointInCircle(localX, localY, 0, 0, HUB_RADIUS)) {
			this.toggleInnerRing();
			return null;
		}

		if (!this.innerExpanded) return null;

		for (const node of this.innerNodes) {
			if (!this.hitInner(node, localX, localY)) continue;
			if (node.key === "actionHub") {
				this.toggleOuterRing();
				return null;
			}
			return node.enabled ? node.action : null;
		}

		if (this.outerOpen) {
			for (const node of this.outerNodes) {
				if (!this.hitOuter(node, localX, localY)) continue;
				return node.enabled ? node.action : null;
			}
		}

		return null;
	}

	// ---------- private ----------

	private hitInner(node: InnerNode, localX: number, localY: number): boolean {
		if (!node.container.visible) return false;
		return pointInCircle(
			localX,
			localY,
			node.container.x,
			node.container.y,
			NODE_RADIUS,
		);
	}

	private hitOuter(node: OuterNode, localX: number, localY: number): boolean {
		if (!node.container.visible) return false;
		return pointInCircle(
			localX,
			localY,
			node.container.x,
			node.container.y,
			NODE_RADIUS,
		);
	}

	private toggleInnerRing(): void {
		this.innerExpanded = !this.innerExpanded;
		this.innerRadiusTarget = this.innerExpanded ? INNER_RING_R : 0;
		if (!this.innerExpanded) {
			this.outerOpen = false;
			for (const node of this.outerNodes) node.targetAngle = HIDDEN_ANGLE;
		}
		this.redrawArrow();
	}

	private toggleOuterRing(): void {
		this.outerOpen = !this.outerOpen;
		for (const node of this.outerNodes) {
			node.targetAngle = this.outerOpen ? node.restAngle : HIDDEN_ANGLE;
		}
	}

	private applyInnerRadius(radius: number): void {
		for (const node of this.innerNodes) {
			node.container.x = radius * Math.cos(node.angle);
			node.container.y = radius * Math.sin(node.angle);
			node.container.visible = radius > 1;
		}
	}

	private setNodeEnabled(key: string, enabled: boolean): void {
		const inner = this.innerNodes.find((n) => n.key === key);
		if (inner) {
			inner.enabled = enabled;
			this.redrawInnerNode(inner, enabled ? 0x2a2a2a : 0x1a1a1a);
			return;
		}
		const outer = this.outerNodes.find((n) => n.key === key);
		if (outer) {
			outer.enabled = enabled;
			this.redrawOuterNode(outer, enabled ? 0x2a2a2a : 0x1a1a1a);
		}
	}

	private buildHub(): void {
		this.hubBg.circle(0, 0, HUB_RADIUS);
		this.hubBg.fill(0x2a2a2a);
		this.hubBg.stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
		this.hub.addChild(this.hubBg);
		this.redrawArrow();
		this.hub.addChild(this.arrowIcon);
		this.view.addChild(this.hub);
	}

	private redrawArrow(): void {
		this.arrowIcon.clear();
		this.arrowIcon.moveTo(-6, -6);
		this.arrowIcon.lineTo(6, 0);
		this.arrowIcon.lineTo(-6, 6);
		this.arrowIcon.stroke({ width: 2, color: 0xffffff });
		this.arrowIcon.rotation = this.innerExpanded ? Math.PI : 0;
	}

	private buildInnerRing(): void {
		this.innerNodes.push(
			this.makeInnerNode("move", "move", INNER_ANGLES.move, () => {}),
		);
		this.innerNodes.push(
			this.makeInnerNode("actionHub", null, INNER_ANGLES.actionHub, () => {}),
		);
		this.innerNodes.push(
			this.makeInnerNode("endTurn", "endTurn", INNER_ANGLES.endTurn, () => {}),
		);

		for (const node of this.innerNodes) this.view.addChild(node.container);
		this.applyInnerRadius(INNER_RING_R);

		this.attachSvgIcon(this.innerNodes[0].container, moveSvgUrl);
		this.attachSvgIcon(this.innerNodes[1].container, actionsSvgUrl);
		this.attachSvgIcon(this.innerNodes[2].container, endTurnSvgUrl);
	}

	/**
	 * Outer ring construction. Attack uses the real SVG-icon pattern (see
	 * attachSvgIcon); Rest/Disengage still use hand-drawn placeholders
	 * until their own icons are downloaded and swapped in the same way.
	 */
	private buildOuterRing(): void {
		this.outerNodes.push(
			this.makeOuterNode(
				"disengage",
				"disengage",
				OUTER_ANGLES.disengage,
				() => {},
			),
		);
		this.outerNodes.push(
			this.makeOuterNode("rest", "rest", OUTER_ANGLES.rest, () => {}),
		);
		this.outerNodes.push(
			this.makeOuterNode("attack", "attack", OUTER_ANGLES.attack, () => {}),
		);

		for (const node of this.outerNodes) {
			this.view.addChild(node.container);
			node.container.x = OUTER_RING_R * Math.cos(HIDDEN_ANGLE);
			node.container.y = OUTER_RING_R * Math.sin(HIDDEN_ANGLE);
			node.container.visible = false;
		}

		this.attachSvgIcon(this.outerNodes[0].container, engageSvgUrl);
		this.attachSvgIcon(this.outerNodes[1].container, restSvgUrl);
		this.attachSvgIcon(this.outerNodes[2].container, attackSvgUrl);
	}

	/**
	 * The standard pattern for every real (downloaded) icon on the wheel —
	 * load as a texture-backed Sprite, size and mask against NODE_RADIUS
	 * (the button's own real border, not a guessed number), attach as a
	 * child so it moves with the button for free. Async — the icon pops
	 * in shortly after the button itself exists, not before. Sized and
	 * masked slightly past NODE_RADIUS so the icon reads as filling the
	 * circle right up to the border, not floating undersized inside it.
	 */
	private attachSvgIcon(container: Container, svgUrl: string): void {
		loadIconSprite(svgUrl, NODE_RADIUS * 1.6).then((sprite: Sprite) => {
			const clip = new Graphics();
			clip.circle(0, 0, NODE_RADIUS + 2);
			clip.fill(0xffffff);

			container.addChild(sprite);
			container.addChild(clip);
			sprite.mask = clip;
		});
	}

	private makeInnerNode(
		key: string,
		action: ButtonAction,
		angle: number,
		drawIcon: (g: Graphics) => void,
	): InnerNode {
		const container = new Container();
		const bg = new Graphics();
		bg.circle(0, 0, NODE_RADIUS);
		bg.fill(0x2a2a2a);
		bg.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
		container.addChild(bg);
		const icon = new Graphics();
		drawIcon(icon);
		container.addChild(icon);
		return { key, action, angle, enabled: true, container, bg };
	}

	private makeOuterNode(
		key: string,
		action: ButtonAction,
		restAngle: number,
		drawIcon: (g: Graphics) => void,
	): OuterNode {
		const container = new Container();
		const bg = new Graphics();
		bg.circle(0, 0, NODE_RADIUS);
		bg.fill(0x2a2a2a);
		bg.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
		container.addChild(bg);
		const icon = new Graphics();
		drawIcon(icon);
		container.addChild(icon);
		return {
			key,
			action,
			restAngle,
			currentAngle: HIDDEN_ANGLE,
			targetAngle: HIDDEN_ANGLE,
			enabled: true,
			container,
			bg,
		};
	}

	private redrawInnerNode(node: InnerNode, color: number): void {
		node.bg.clear();
		node.bg.circle(0, 0, NODE_RADIUS);
		node.bg.fill(color);
		node.bg.stroke({
			width: 2,
			color: 0xffffff,
			alpha: node.enabled ? 0.6 : 0.3,
		});
	}

	private redrawOuterNode(node: OuterNode, color: number): void {
		node.bg.clear();
		node.bg.circle(0, 0, NODE_RADIUS);
		node.bg.fill(color);
		node.bg.stroke({
			width: 2,
			color: 0xffffff,
			alpha: node.enabled ? 0.6 : 0.3,
		});
	}
}
