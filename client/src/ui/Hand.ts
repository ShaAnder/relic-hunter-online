import { Container, Graphics } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import type { CardData } from "@relic-hunter/shared";
import { Card, CARD_WIDTH, CARD_HEIGHT } from "@/entities/Card";
import type { PlayZone } from "@/ui/PlayZone";

const CARET_PULSE_SPEED = 0.006;
const CARET_PULSE_RANGE = 6;

// Cascade — cards overlap, most of each stays visible. No rotation/arc.
const CARD_STEP = CARD_WIDTH * 0.75; // 25% overlap between adjacent cards
const HIGHLIGHT_LIFT = 22;
const CARET_GAP = 14;

// Hide/reveal — tucked off-screen by default; hover OR tap toggles it.
const REVEALED_Y_OFFSET = 20;
const HIDDEN_Y_OFFSET = CARD_HEIGHT - 25;
const HOVER_EASE_MS = 180;

export const SKIP_CARD_ID = "__skip__";

/**
 * Cascaded hand, bottom-right, tucked off-screen until hovered or
 * tapped. Confirming a card (click, Enter, or dragging it into the
 * independent PlayZone) hands the card's visual off to PlayZone for the
 * grow-slam-vanish sequence. "No Card" now lives as a button on PlayZone
 * itself, not a draggable card in this row.
 * @param stage - screen-spanning interactive container, needed so a drag
 *   keeps tracking the pointer once it moves off the card itself
 * @param playZone - the independent entity plays get sent to; shown/hidden
 *   directly by this class around selection mode
 * @param onCardConfirmed - fired once PlayZone's sequence finishes, or
 *   immediately for "No Card"
 * @author ShaAnder
 */
export class Hand {
	readonly view = new Container();
	private fanContainer = new Container();
	private hitArea = new Graphics(); // invisible, catches tap-to-toggle outside selection mode

	private cards: Card[] = [];
	private onCardConfirmed?: (card: CardData) => void;

	private selecting = false;
	private highlightedIndex = -1;
	private selectableFilter: (data: CardData) => boolean = () => true;

	private isHovered = false;
	private forceRevealed = false;
	private manuallyToggled = false;

	private caret = new Container();
	private caretElapsedMs = 0;

	// Drag state
	private draggingCard: Card | null = null;
	private dragOffset = { x: 0, y: 0 };
	private lastDragGlobal = { x: 0, y: 0 };
	private resolved = false;

	constructor(
		private stage: Container,
		private playZone: PlayZone,
		onCardConfirmed?: (card: CardData) => void,
	) {
		this.onCardConfirmed = onCardConfirmed;

		this.view.addChild(this.fanContainer);
		this.fanContainer.y = HIDDEN_Y_OFFSET;

		this.hitArea.eventMode = "static";
		this.hitArea.cursor = "pointer";
		this.hitArea.on("pointerdown", () => this.handleHitAreaTap());
		this.fanContainer.addChild(this.hitArea);

		this.buildCaret();
		this.caret.visible = false;
		this.fanContainer.addChild(this.caret);

		this.playZone.setNoCardHandler(() => this.resolveNoCard());
	}

	get isSelecting(): boolean {
		return this.selecting;
	}

	/** Called from the scene's own mousemove handler — proximity to the hand's corner. */
	setHovered(isHovered: boolean): void {
		this.isHovered = isHovered;
	}

	syncFromHand(hand: CardData[]): void {
		this.clear();

		hand.forEach((data) => {
			const card = new Card(data);
			card.setInteractive(false);
			card.setGreyedOut(false);
			card.view.pivot.set(CARD_WIDTH / 2, CARD_HEIGHT);
			this.cards.push(card);
			this.fanContainer.addChild(card.view);

			card.view.on("pointerover", () => this.handlePointerOverCard(card));
			card.view.on("pointerdown", (e) => this.handlePointerDownCard(card, e));
		});

		this.redrawHitArea();
		this.layoutCards();
	}

	enterSelectionMode(filter: (data: CardData) => boolean): void {
		this.selectableFilter = filter;
		this.selecting = true;
		this.forceRevealed = true;
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
		this.forceRevealed = false;
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
		if (!this.selecting || this.cards.length === 0) return;

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
		if (this.highlightedIndex < 0 || this.highlightedIndex >= this.cards.length)
			return;
		void this.playCard(this.cards[this.highlightedIndex]);
	}

	update(deltaTime: number): void {
		const deltaMs = (deltaTime / 60) * 1000;

		const targetY =
			this.isHovered || this.forceRevealed || this.manuallyToggled
				? REVEALED_Y_OFFSET
				: HIDDEN_Y_OFFSET;
		const easeT = Math.min(1, deltaMs / HOVER_EASE_MS);
		this.fanContainer.y += (targetY - this.fanContainer.y) * easeT;

		if (this.caret.visible) {
			this.caretElapsedMs += deltaMs;
			const bob =
				Math.sin(this.caretElapsedMs * CARET_PULSE_SPEED) * CARET_PULSE_RANGE;
			this.positionCaret(bob);
		}
	}

	/** Bottom-right of the screen. */
	resize(screenWidth: number, screenHeight: number): void {
		// Pivot far enough right that the leftmost card still has a visible gap
		// from the screen edge (and from the bottom-left UI cluster).
		this.view.x = 100;
		this.view.y = screenHeight;
		void screenWidth;
		this.layoutCards();
	}

	getCards(): Card[] {
		return this.cards;
	}

	// ---------- private ----------

	/** Tap-to-toggle — only outside selection mode, so it never fights with an active play decision. */
	private handleHitAreaTap(): void {
		if (this.selecting) return;
		this.manuallyToggled = !this.manuallyToggled;
	}

	private isSelectable(card: Card): boolean {
		return this.selectableFilter(card.getData());
	}

	private handlePointerOverCard(card: Card): void {
		if (!this.selecting || !this.isSelectable(card) || this.draggingCard)
			return;
		const index = this.cards.indexOf(card);
		if (index === -1) return;
		this.highlightedIndex = index;
		this.applyHighlight();
	}

	private handlePointerDownCard(
		card: Card,
		event: FederatedPointerEvent,
	): void {
		if (!this.selecting || !this.isSelectable(card)) return;

		this.draggingCard = card;
		const localPos = this.fanContainer.toLocal(event.global);
		this.dragOffset = {
			x: card.view.x - localPos.x,
			y: card.view.y - localPos.y,
		};
		this.lastDragGlobal = { x: event.global.x, y: event.global.y };

		this.stage.on("pointermove", this.onDragMove);
		this.stage.on("pointerup", this.onDragEnd);
		this.stage.on("pointerupoutside", this.onDragEnd);
	}

	private onDragMove = (event: FederatedPointerEvent): void => {
		if (!this.draggingCard) return;
		const localPos = this.fanContainer.toLocal(event.global);
		this.draggingCard.view.x = localPos.x + this.dragOffset.x;
		this.draggingCard.view.y = localPos.y + this.dragOffset.y;
		this.lastDragGlobal = { x: event.global.x, y: event.global.y };
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
			this.layoutCards(); // snaps back to its resting slot
		}
	};

	/** Hands the card off to PlayZone for the slam sequence, regardless of trigger method. */
	private async playCard(card: Card): Promise<void> {
		if (this.resolved) return;
		this.resolved = true;

		const data = card.getData();
		card.setInteractive(false);

		await this.playZone.playCard(card, data);

		this.onCardConfirmed?.(data);
		this.exitSelectionMode();
	}

	/** "No Card" clicked on PlayZone's own button — resolves instantly, no card, no slam. */
	private resolveNoCard(): void {
		if (!this.selecting || this.resolved) return;
		this.resolved = true;
		this.onCardConfirmed?.(this.buildSkipCardData());
		this.exitSelectionMode();
	}

	private applyHighlight(): void {
		this.cards.forEach((card, i) =>
			card.setHighlighted(i === this.highlightedIndex),
		);
		this.layoutCards();
	}

	/** Cascaded layout — each card offset by CARD_STEP, no rotation. Highlighted card lifts straight up. */
	private layoutCards(): void {
		this.cards.forEach((card, i) => {
			if (card === this.draggingCard) return;

			const isHighlighted = i === this.highlightedIndex && this.selecting;
			card.view.rotation = 0;
			card.view.x = i * CARD_STEP;
			card.view.y = isHighlighted ? -HIGHLIGHT_LIFT : 0;
			card.view.alpha = 1;
			card.view.scale.set(1);
		});

		if (this.selecting) this.positionCaret(0);
	}

	/** Invisible rect covering the cascaded row's rough footprint, for tap-to-toggle. */
	private redrawHitArea(): void {
		this.hitArea.clear();
		const n = Math.max(1, this.cards.length);
		const width = CARD_WIDTH + (n - 1) * CARD_STEP;
		this.hitArea.rect(0, -CARD_HEIGHT, width, CARD_HEIGHT);
		this.hitArea.fill({ color: 0x000000, alpha: 0.001 }); // invisible but still hit-testable
	}

	private buildCaret(): void {
		const g = new Graphics();
		g.poly([0, 0, 16, 0, 8, 12]);
		g.fill(0xffd700);
		this.caret.addChild(g);
	}

	private positionCaret(bob: number): void {
		if (this.highlightedIndex < 0 || this.highlightedIndex >= this.cards.length)
			return;
		const card = this.cards[this.highlightedIndex];
		this.caret.x = card.view.x;
		this.caret.y = card.view.y - CARD_HEIGHT - CARET_GAP - HIGHLIGHT_LIFT + bob;
	}

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
