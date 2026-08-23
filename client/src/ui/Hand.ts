import { Container, Graphics } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import type { CardData } from "@relic-hunter/shared";
import { Card, CARD_WIDTH, CARD_HEIGHT } from "@/entities/Card";
import { computeUiScale } from "@/math/uiScale";
import type { PlayZone } from "@/ui/PlayZone";

const CARET_PULSE_SPEED = 0.006;
const CARET_PULSE_RANGE = 6;

const CARD_STEP = CARD_WIDTH * 0.82;
const SPLAY_GAP = CARD_WIDTH + 50;

const HIGHLIGHT_LIFT = 22;
const CARET_GAP = 14;

const SPLAY_EASE_MS = 160;

export const SKIP_CARD_ID = "__skip__";

/**
 * Battle hand layout.
 *
 * In battle mode the holder remains centred and the cards fan
 * symmetrically around it in a shallow semicircle.
 *
 * Map mode retains the original left-anchored cascade.
 *
 * @author ShaAnder
 */
export class Hand {
	readonly view = new Container();

	private fanContainer = new Container();
	private holder = new Graphics();

	/** Guide arc shown behind the battle hand. */
	private fanGuide = new Graphics();

	private cards: Card[] = [];
	private onCardConfirmed?: (card: CardData) => void;

	private selecting = false;
	private highlightedIndex = -1;
	private selectableFilter: (data: CardData) => boolean = () => true;

	private isHovered = false;
	private isHeld = false;
	private splayProgress = 0;

	private caret = new Container();
	private caretElapsedMs = 0;

	// Drag state
	private draggingCard: Card | null = null;
	private dragOffset = { x: 0, y: 0 };
	private lastDragGlobal = { x: 0, y: 0 };
	private resolved = false;

	/**
	 * Current positioning mode.
	 *
	 * "left"   = map-style cascade
	 * "center" = battle semicircle
	 */
	private anchor: "left" | "center" = "left";

	constructor(
		private stage: Container,
		private playZone: PlayZone,
		onCardConfirmed?: (card: CardData) => void,
	) {
		this.onCardConfirmed = onCardConfirmed;

		this.view.addChild(this.fanContainer);

		this.buildFanGuide();
		this.fanContainer.addChild(this.fanGuide);

		this.buildHolder();
		this.view.addChild(this.holder);

		this.buildCaret();
		this.caret.visible = false;
		this.fanContainer.addChild(this.caret);

		this.playZone.setNoCardHandler(() => this.resolveNoCard());
	}

	get isSelecting(): boolean {
		return this.selecting;
	}

	/**
	 * Called from the scene's mousemove handler.
	 * Desktop convenience only; press-and-hold remains the
	 * primary touch-compatible trigger.
	 */
	setHovered(isHovered: boolean): void {
		this.isHovered = isHovered;
	}

	syncFromHand(hand: CardData[]): void {
		this.clear();

		hand.forEach((data) => {
			const card = new Card(data);

			card.setInteractive(false);
			card.setGreyedOut(false);

			// Cards use their bottom-centre as their local origin.
			card.view.pivot.set(CARD_WIDTH / 2, CARD_HEIGHT);

			this.cards.push(card);
			this.fanContainer.addChild(card.view);

			card.view.on("pointerover", () => this.handlePointerOverCard(card));

			card.view.on("pointerdown", (e) => this.handlePointerDownCard(card, e));
		});

		this.layoutCards();
	}

	enterSelectionMode(filter: (data: CardData) => boolean): void {
		this.selectableFilter = filter;
		this.selecting = true;
		this.resolved = false;

		this.cards.forEach((card) => {
			const selectable = this.isSelectable(card);

			card.setInteractive(selectable);
			card.setGreyedOut(!selectable);
		});

		const firstSelectable = this.cards.findIndex((c) => this.isSelectable(c));

		this.highlightedIndex = firstSelectable;
		this.caret.visible = firstSelectable !== -1;

		this.applyHighlight();

		this.playZone.show();
	}

	exitSelectionMode(): void {
		this.selecting = false;
		this.highlightedIndex = -1;
		this.caret.visible = false;

		this.cards.forEach((card) => {
			card.setHighlighted(false);
			card.setInteractive(false);
			card.setGreyedOut(false);
		});

		this.layoutCards();

		this.playZone.hide();
	}

	moveCaret(direction: 1 | -1): void {
		if (!this.selecting || this.cards.length === 0) {
			return;
		}

		const total = this.cards.length;
		let next = this.highlightedIndex;

		for (let i = 0; i < total; i++) {
			next = (next + direction + total) % total;

			if (this.isSelectable(this.cards[next])) {
				this.highlightedIndex = next;
				this.applyHighlight();
				return;
			}
		}
	}

	confirmHighlighted(): void {
		if (!this.selecting) return;

		if (
			this.highlightedIndex < 0 ||
			this.highlightedIndex >= this.cards.length
		) {
			return;
		}

		void this.playCard(this.cards[this.highlightedIndex]);
	}

	update(deltaTime: number): void {
		const deltaMs = (deltaTime / 60) * 1000;

		const splayTarget = this.isHovered || this.isHeld || this.selecting ? 1 : 0;

		const easeT = Math.min(1, deltaMs / SPLAY_EASE_MS);

		this.splayProgress += (splayTarget - this.splayProgress) * easeT;

		this.layoutCards();

		if (this.caret.visible) {
			this.caretElapsedMs += deltaMs;

			const bob =
				Math.sin(this.caretElapsedMs * CARET_PULSE_SPEED) * CARET_PULSE_RANGE;

			this.positionCaret(bob);
		}
	}

	/**
	 * @param anchor
	 * "left"   = map holder bottom-left, cards splay right
	 * "center" = battle holder centered, cards fan around it
	 */
	resize(
		screenWidth: number,
		screenHeight: number,
		s?: number,
		anchor: "left" | "center" = "left",
	): void {
		const scale = s ?? computeUiScale(screenWidth, screenHeight);

		this.anchor = anchor;

		this.view.scale.set(scale);

		const margin = 16 * scale;

		if (anchor === "center") {
			/*
			 * Battle:
			 *
			 * Keep the logical hand origin exactly at screen centre.
			 * Cards fan around this point rather than shifting the
			 * hand itself to make room for them.
			 */
			this.view.x = screenWidth / 2;
			this.view.y = screenHeight - 16 * scale;
		} else {
			/*
			 * Map:
			 *
			 * Keep the original left-side holder positioning.
			 */
			this.view.x = margin + (CARD_WIDTH / 2) * scale;

			this.view.y = screenHeight - 16 * scale;
		}

		this.layoutCards();
	}

	getCards(): Card[] {
		return this.cards;
	}

	// ---------- construction ----------

	/**
	 * Subtle semicircular guide line behind the cards.
	 *
	 * It is deliberately drawn in design pixels. The parent hand
	 * is scaled uniformly by resize(), so the guide follows the
	 * same responsive UI scaling as the cards and holder.
	 */
	private buildFanGuide(): void {
		this.fanGuide.clear();

		const radius = CARD_WIDTH * 1.65;
		const startAngle = Math.PI * 0.18;
		const endAngle = Math.PI * 0.82;

		const centerY = 8;

		const steps = 32;

		for (let i = 0; i <= steps; i++) {
			const t = i / steps;

			const angle = Math.PI - (startAngle + (endAngle - startAngle) * t);

			const x = Math.cos(angle) * radius;

			const y = centerY - Math.sin(angle) * radius * 0.34;

			if (i === 0) {
				this.fanGuide.moveTo(x, y);
			} else {
				this.fanGuide.lineTo(x, y);
			}
		}

		this.fanGuide.stroke({
			width: 2,
			color: 0x666666,
			alpha: 0.35,
		});

		this.fanGuide.visible = false;
	}

	/**
	 * Card-shaped, always-visible holder.
	 */
	private buildHolder(): void {
		const w = CARD_WIDTH;
		const h = CARD_HEIGHT;

		this.holder.roundRect(-w / 2, -h, w, h, 6);

		this.holder.fill(0x2a2a2a);

		this.holder.stroke({
			width: 2,
			color: 0x666666,
		});

		this.holder.roundRect(-w / 2 + 8, -h + 8, w - 16, h - 16, 4);

		this.holder.stroke({
			width: 1.5,
			color: 0x555555,
		});

		this.holder.eventMode = "static";
		this.holder.cursor = "pointer";

		this.holder.on("pointerdown", () => this.handleHolderDown());
	}

	private buildCaret(): void {
		const g = new Graphics();

		g.poly([0, 0, 16, 0, 8, 12]);

		g.fill(0xffd700);

		this.caret.addChild(g);
	}

	// ---------- holder interaction ----------

	private handleHolderDown(): void {
		if (this.selecting) return;

		this.isHeld = true;

		this.stage.on("pointerup", this.onHolderRelease);

		this.stage.on("pointerupoutside", this.onHolderRelease);
	}

	private onHolderRelease = (): void => {
		this.isHeld = false;

		this.stage.off("pointerup", this.onHolderRelease);

		this.stage.off("pointerupoutside", this.onHolderRelease);
	};

	// ---------- card interaction ----------

	private isSelectable(card: Card): boolean {
		return this.selectableFilter(card.getData());
	}

	private handlePointerOverCard(card: Card): void {
		if (!this.selecting || !this.isSelectable(card) || this.draggingCard) {
			return;
		}

		const index = this.cards.indexOf(card);

		if (index === -1) return;

		this.highlightedIndex = index;
		this.applyHighlight();
	}

	private handlePointerDownCard(
		card: Card,
		event: FederatedPointerEvent,
	): void {
		if (!this.selecting || !this.isSelectable(card)) {
			return;
		}

		this.draggingCard = card;

		this.lastDragGlobal = {
			x: event.global.x,
			y: event.global.y,
		};

		/*
		 * Lift the card out of the hand so it renders above
		 * the map + HUD.
		 */
		const globalPos = card.view.getGlobalPosition();

		card.view.removeFromParent();
		this.stage.addChild(card.view);

		card.view.x = globalPos.x;
		card.view.y = globalPos.y;

		card.view.scale.set(1.08);
		card.view.alpha = 0.95;

		this.dragOffset = {
			x: globalPos.x - event.global.x,

			y: globalPos.y - event.global.y,
		};

		this.stage.on("pointermove", this.onDragMove);

		this.stage.on("pointerup", this.onDragEnd);

		this.stage.on("pointerupoutside", this.onDragEnd);
	}

	private onDragMove = (event: FederatedPointerEvent): void => {
		if (!this.draggingCard) return;

		this.draggingCard.view.x = event.global.x + this.dragOffset.x;

		this.draggingCard.view.y = event.global.y + this.dragOffset.y;

		this.lastDragGlobal = {
			x: event.global.x,
			y: event.global.y,
		};

		const over = this.playZone.containsGlobalPoint(
			event.global.x,
			event.global.y,
		);

		this.draggingCard.view.scale.set(over ? 1.18 : 1.08);
	};

	private onDragEnd = (): void => {
		if (!this.draggingCard) return;

		this.stage.off("pointermove", this.onDragMove);

		this.stage.off("pointerup", this.onDragEnd);

		this.stage.off("pointerupoutside", this.onDragEnd);

		const card = this.draggingCard;
		this.draggingCard = null;

		if (
			this.playZone.containsGlobalPoint(
				this.lastDragGlobal.x,
				this.lastDragGlobal.y,
			)
		) {
			void this.playCard(card);
		} else {
			card.view.scale.set(1);
			card.view.alpha = 1;

			card.view.removeFromParent();

			this.fanContainer.addChild(card.view);

			this.layoutCards();
		}
	};

	// ---------- play ----------

	private async playCard(card: Card): Promise<void> {
		if (this.resolved) return;

		this.resolved = true;

		const data = card.getData();

		card.setInteractive(false);

		await this.playZone.playCard(card, data);

		this.onCardConfirmed?.(data);

		this.exitSelectionMode();
	}

	private resolveNoCard(): void {
		if (!this.selecting || this.resolved) {
			return;
		}

		this.resolved = true;

		this.onCardConfirmed?.(this.buildSkipCardData());

		this.exitSelectionMode();
	}

	// ---------- layout ----------

	private applyHighlight(): void {
		this.cards.forEach((card, i) =>
			card.setHighlighted(i === this.highlightedIndex),
		);

		this.layoutCards();
	}

	/**
	 * Main card layout dispatcher.
	 */
	private layoutCards(): void {
		if (this.anchor === "center") {
			this.layoutBattleFan();
		} else {
			this.layoutMapCascade();
		}

		if (this.selecting) {
			this.positionCaret(0);
		}
	}

	/**
	 * Original map hand.
	 *
	 * Cards cascade out to the right from the holder.
	 */
	private layoutMapCascade(): void {
		this.fanGuide.visible = false;

		this.cards.forEach((card, i) => {
			if (card === this.draggingCard) {
				return;
			}

			const isHighlighted = i === this.highlightedIndex && this.selecting;

			card.view.rotation = 0;

			card.view.x = (SPLAY_GAP + i * CARD_STEP) * this.splayProgress;

			card.view.y = isHighlighted ? -HIGHLIGHT_LIFT : 0;

			card.view.alpha = this.splayProgress < 0.05 ? 0 : this.splayProgress;

			card.view.scale.set(1);
		});
	}

	/**
	 * Battle hand:
	 *
	 *             [C]
	 *        [C]       [C]
	 *     [C]             [C]
	 *             HAND
	 *
	 * The holder remains at x=0. Cards are positioned
	 * symmetrically around x=0 and rise into a shallow arc.
	 */
	private layoutBattleFan(): void {
		this.fanGuide.visible = this.splayProgress > 0.05;

		const count = this.cards.length;

		if (count === 0) return;

		/*
		 * Maximum angular spread.
		 *
		 * With many cards we don't want the hand to become
		 * absurdly wide on mobile, so the outer cards are
		 * constrained to roughly ±55 degrees.
		 */
		const maxAngle = Math.PI * 0.3;

		/*
		 * Radius controls the height of the fan.
		 *
		 * The card pivot is bottom-centre, so cards naturally
		 * extend upward from these points.
		 */
		const radius = CARD_WIDTH * 1.55;

		const maxWidth = CARD_WIDTH * 0.92;

		this.cards.forEach((card, i) => {
			if (card === this.draggingCard) {
				return;
			}

			const isHighlighted = i === this.highlightedIndex && this.selecting;

			/*
			 * Normalized position:
			 *
			 * -1 = far left
			 *  0 = centre
			 * +1 = far right
			 */
			const normalized = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;

			/*
			 * Angle is mirrored around the centre.
			 */
			const angle = normalized * maxAngle;

			/*
			 * x position around the circle.
			 */
			const targetX = Math.sin(angle) * radius;

			/*
			 * y position:
			 *
			 * centre cards are lowest,
			 * outer cards rise.
			 *
			 * This creates the shallow
			 * semicircular / fan appearance.
			 */
			const targetY = -Math.abs(normalized) * Math.abs(normalized) * maxWidth;

			/*
			 * Folded state:
			 *
			 * Every card converges toward
			 * the holder's centre.
			 */
			card.view.x = targetX * this.splayProgress;

			card.view.y = targetY * this.splayProgress;

			/*
			 * Rotate cards along the fan.
			 *
			 * Negative on the left,
			 * positive on the right.
			 */
			card.view.rotation = -angle * 0.72 * this.splayProgress;

			/*
			 * Highlighted card gets a little extra lift
			 * without breaking the fan.
			 */
			if (isHighlighted) {
				card.view.y -= HIGHLIGHT_LIFT;
			}

			card.view.alpha = this.splayProgress < 0.05 ? 0 : this.splayProgress;

			card.view.scale.set(1);
		});
	}

	// ---------- caret ----------

	private positionCaret(bob: number): void {
		if (
			this.highlightedIndex < 0 ||
			this.highlightedIndex >= this.cards.length
		) {
			return;
		}

		const card = this.cards[this.highlightedIndex];

		this.caret.x = card.view.x;

		this.caret.y = card.view.y - CARD_HEIGHT - CARET_GAP - HIGHLIGHT_LIFT + bob;
	}

	// ---------- misc ----------

	private buildSkipCardData(): CardData {
		return {
			id: SKIP_CARD_ID,
			color: "none",
			name: "No Card",
			value: 0,
			description: "Move on base speed only — no card bonus",
			actionType: "move",
		};
	}

	private clear(): void {
		this.cards.forEach((c) => c.view.removeFromParent());

		this.cards = [];
		this.resolved = false;
	}
}
