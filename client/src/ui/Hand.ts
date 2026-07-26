import { Container, Graphics, Text } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import type { CardData } from "@relic-hunter/shared";
import { Card, CARD_WIDTH, CARD_HEIGHT } from "@/entities/Card";
import type { PlayZone } from "@/ui/PlayZone";

const CARET_PULSE_SPEED = 0.006;
const CARET_PULSE_RANGE = 6;
const OVERLAY_DURATION_MS = 1500;

const HAND_CARD_SCALE = 0.65;
const CARD_GAP = 14;
const HIGHLIGHT_LIFT = 22;
const CARET_GAP = 14;

const HOVER_EASE_MS = 180;

export const SKIP_CARD_ID = "__skip__";

/**
 * Straight-line hand, bottom-left. Confirming a card (click, Enter, or
 * dragging it into the independent PlayZone entity) hands the card's
 * visual off to PlayZone for the grow-slam-vanish sequence — Hand itself
 * no longer owns any of that animation.
 * @param stage - screen-spanning interactive container, needed so a drag
 *   keeps tracking the pointer once it moves off the card itself
 * @param playZone - the independent center-screen entity plays get sent to
 * @param onCardConfirmed - fired once PlayZone's sequence finishes
 * @author ShaAnder
 */
export class Hand {
	readonly view = new Container();
	private fanContainer = new Container();

	private cards: Card[] = [];
	private onCardConfirmed?: (card: CardData) => void;

	private selecting = false;
	private highlightedIndex = -1;
	private selectableFilter: (data: CardData) => boolean = () => true;

	private isHovered = false;
	private forceRevealed = false;

	private caret = new Container();
	private caretElapsedMs = 0;

	private overlayBg = new Graphics();
	private overlayText: Text;
	private overlayTimerMs = 0;

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

		this.buildCaret();
		this.caret.visible = false;
		this.fanContainer.addChild(this.caret);

		this.overlayText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 13, align: "center" },
		});
		this.overlayText.anchor.set(0.5, 0);
		this.fanContainer.addChild(this.overlayBg);
		this.fanContainer.addChild(this.overlayText);
		this.overlayBg.visible = false;
		this.overlayText.visible = false;
	}

	get isSelecting(): boolean {
		return this.selecting;
	}

	setHovered(isHovered: boolean): void {
		this.isHovered = isHovered;
	}

	syncFromHand(hand: CardData[]): void {
		this.clear();

		const displayCards = [...hand, this.buildSkipCardData()];

		displayCards.forEach((data) => {
			const card = new Card(data);
			card.setInteractive(false);
			card.setGreyedOut(false);
			card.view.pivot.set(CARD_WIDTH / 2, CARD_HEIGHT);
			card.view.scale.set(HAND_CARD_SCALE);
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

		if (this.caret.visible) {
			this.caretElapsedMs += deltaMs;
			const bob =
				Math.sin(this.caretElapsedMs * CARET_PULSE_SPEED) * CARET_PULSE_RANGE;
			this.positionCaret(bob);
		}

		if (this.overlayTimerMs > 0) {
			this.overlayTimerMs -= deltaMs;
			if (this.overlayTimerMs <= 0) {
				this.overlayBg.visible = false;
				this.overlayText.visible = false;
			}
		}
	}

	/** Bottom-left of the screen — no longer anchored to CharacterPanel. */
	resize(screenWidth: number, screenHeight: number): void {
		this.view.x = 200;
		this.view.y = screenHeight - 70;
		void screenWidth;
		this.layoutCards();
	}

	getCards(): Card[] {
		return this.cards;
	}

	// ---------- private ----------

	private isSelectable(card: Card): boolean {
		const data = card.getData();
		if (data.id === SKIP_CARD_ID) return true;
		return this.selectableFilter(data);
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

	/**
	 * Hands the card off to PlayZone for the grow-slam-vanish sequence,
	 * regardless of how confirmation happened — click, Enter, or drag all
	 * play out the same way in the same place.
	 */
	private async playCard(card: Card): Promise<void> {
		if (this.resolved) return;
		this.resolved = true;

		const data = card.getData();
		card.setInteractive(false);

		await this.playZone.playCard(card, data);

		this.onCardConfirmed?.(data);
		this.exitSelectionMode();
	}

	private applyHighlight(): void {
		this.cards.forEach((card, i) =>
			card.setHighlighted(i === this.highlightedIndex),
		);
		this.layoutCards();
	}

	private layoutCards(): void {
		const n = this.cards.length;
		if (n === 0) return;

		const cardWidth = CARD_WIDTH * HAND_CARD_SCALE;
		const step = cardWidth + CARD_GAP;

		this.cards.forEach((card, i) => {
			if (card === this.draggingCard) return;

			const isHighlighted = i === this.highlightedIndex && this.selecting;
			card.view.rotation = 0;
			card.view.x = i * step;
			card.view.y = isHighlighted ? -HIGHLIGHT_LIFT : 0;
			if (!this.resolved) card.view.scale.set(HAND_CARD_SCALE);
			card.view.alpha = 1;
		});

		if (this.selecting) this.positionCaret(0);
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
		this.caret.y =
			card.view.y -
			CARD_HEIGHT * HAND_CARD_SCALE -
			CARET_GAP -
			HIGHLIGHT_LIFT +
			bob;
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
