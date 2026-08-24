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

		const splayTarget =
			this.anchor === "center" ||
			this.isHovered ||
			this.isHeld ||
			this.selecting
				? 1
				: 0;

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

		// Battle mode shows all cards directly, always — no holder,
		// nothing to press or hold, the overworld's hold-to-reveal
		// interaction doesn't apply here at all.
		this.holder.visible = anchor !== "center";

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

	/** Global position of a specific card by id, or the first card if no id given — null if the hand is empty or no match. Used by tutorial UI pointers. */
	getCardScreenPosition(cardId?: string): { x: number; y: number } | null {
		const card = cardId
			? this.cards.find((c) => c.getData().id === cardId)
			: this.cards[0];
		if (!card) return null;
		return card.view.getGlobalPosition();
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

		card.view.scale.set(this.view.scale.x * 1.08);
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
			x: this.draggingCard.view.x,
			y: this.draggingCard.view.y,
		};

		// Test the card's own visual position, not the pointer's — the
		// gap between where a finger grabs a card and the card's own
		// center is a fixed number of pixels, which becomes a much
		// larger fraction of a small, scaled-down zone than a full-size
		// one, making the card look like it should be "in" while the
		// pointer itself tests as outside.
		const over = this.playZone.containsGlobalPoint(
			this.draggingCard.view.x,
			this.draggingCard.view.y,
		);

		// This runs every frame of the drag — must scale with the
		// current UI scale like the initial pointerdown assignment does,
		// or it immediately overwrites that fix the instant the pointer
		// moves, leaving the card rendered at a fixed absolute size
		// regardless of how small the rest of the UI currently is.
		this.draggingCard.view.scale.set(this.view.scale.x * (over ? 1.18 : 1.08));
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

		// Remove it from the hand's own array immediately, before handing
		// off to PlayZone — not just clearing draggingCard. update() runs
		// every frame via the game's own ticker regardless of this async
		// function's progress, and layoutCards() only ever skipped this
		// card by checking `card === this.draggingCard`. The instant that
		// goes null (which happens in onDragEnd, well before this method
		// even starts), the card re-enters normal cascade layout while
		// PlayZone's ~860ms snap/hold/fade sequence is still actively
		// tweening the same x/y properties on the same object — two
		// systems fighting over one transform, in two different
		// coordinate spaces, every single frame.
		const idx = this.cards.indexOf(card);
		if (idx !== -1) this.cards.splice(idx, 1);

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
			this.layoutBattleRow();
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
	 * Battle hand — no holder, no fan, no hold-to-reveal. All cards sit
	 * in a flat row at all times, each overlapping the next by 10% of a
	 * card's width, centered on x=0. splayProgress still drives alpha
	 * (used once, briefly, for the initial fade-in) but is always pinned
	 * at 1 by update() in this mode, so it never folds.
	 */
	private layoutBattleRow(): void {
		this.fanGuide.visible = false;

		const count = this.cards.length;
		if (count === 0) return;

		const gap = CARD_WIDTH * 0.9;
		const totalWidth = (count - 1) * gap;
		const startX = -totalWidth / 2;

		this.cards.forEach((card, i) => {
			if (card === this.draggingCard) return;

			const isHighlighted = i === this.highlightedIndex && this.selecting;

			card.view.rotation = 0;
			card.view.x = startX + i * gap;
			card.view.y = isHighlighted ? -HIGHLIGHT_LIFT : 0;
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
