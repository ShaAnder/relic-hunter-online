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

// Accordion — cards sit folded behind the holder (all at x=0) until
// held or in selection mode, then splay out to the right. splayProgress
// eases 0→1, multiplying each card's normal cascade offset, rather than
// the old vertical slide-reveal.
const SPLAY_EASE_MS = 160;
const HOLDER_WIDTH = CARD_WIDTH * 0.7;

export const SKIP_CARD_ID = "__skip__";

/**
 * Cascaded hand, folded behind a compact holder icon by default — press
 * and hold the holder (or hover it, on desktop) to splay the hand out
 * to the right; release to fold it back.
 * @param stage - screen-spanning interactive container
 * @param playZone - the independent entity plays get sent to
 * @param onCardConfirmed - fired once PlayZone's sequence finishes, or
 *   immediately for "No Card"
 * @author ShaAnder
 */
export class Hand {
	readonly view = new Container();
	private fanContainer = new Container();
	private holder = new Graphics();

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

	constructor(
		private stage: Container,
		private playZone: PlayZone,
		onCardConfirmed?: (card: CardData) => void,
	) {
		this.onCardConfirmed = onCardConfirmed;

		this.view.addChild(this.fanContainer);

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

	/** Called from the scene's own mousemove handler —
	 * proximity to the holder. Desktop convenience only;
	 * press-and-hold is the primary, touch-compatible trigger. */
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

	/** Bottom-left of the screen — holder sits at a fixed spot, hand splays rightward from it. */
	resize(screenWidth: number, screenHeight: number): void {
		void screenWidth;
		this.view.x = 40;
		this.view.y = screenHeight - 40;
		this.fanContainer.x = HOLDER_WIDTH / 2 + 16;
		this.layoutCards();
	}

	getCards(): Card[] {
		return this.cards;
	}

	// ---------- private ----------

	/** Card-shaped, always-visible holder — press and hold to splay the hand,
	 * release to fold it back. Disabled during selection mode, where the
	 * hand is already forced open. Release is caught on the app-wide stage,
	 * not just the holder itself, so a pointer that drifts off it mid-press
	 * still correctly closes the hand. */
	private buildHolder(): void {
		const w = CARD_WIDTH * 0.7;
		const h = CARD_HEIGHT * 0.7;
		this.holder.roundRect(-w / 2, -h, w, h, 6);
		this.holder.fill(0x2a2a2a);
		this.holder.stroke({ width: 2, color: 0x666666 });
		// Simple card-back motif — a smaller inset rounded rect.
		this.holder.roundRect(-w / 2 + 8, -h + 8, w - 16, h - 16, 4);
		this.holder.stroke({ width: 1.5, color: 0x555555 });

		this.holder.eventMode = "static";
		this.holder.cursor = "pointer";
		this.holder.on("pointerdown", () => this.handleHolderDown());
	}

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
		this.lastDragGlobal = { x: event.global.x, y: event.global.y };

		// Lift the card out of the hand so it renders above the map + HUD.
		const globalPos = card.view.getGlobalPosition();
		card.view.removeFromParent();
		this.stage.addChild(card.view);
		card.view.x = globalPos.x;
		card.view.y = globalPos.y;
		card.view.scale.set(1.08);
		card.view.alpha = 0.95;

		// Offset from the card's current screen position so the grab point stays under the cursor.
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
		this.lastDragGlobal = { x: event.global.x, y: event.global.y };

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
			// Zone already owns the slam sequence; card is still on the stage —
			// playCard will reparent it into the PlayZone view.
			void this.playCard(card);
		} else {
			// Miss: put the card back into the cascade at its resting slot.
			card.view.scale.set(1);
			card.view.alpha = 1;
			card.view.removeFromParent();
			this.fanContainer.addChild(card.view);
			this.layoutCards();
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

	/** Cascaded layout — each card's normal offset scaled by splayProgress,
	 * so 0 = folded flat behind the holder, 1 = fully splayed.
	 * Highlighted card still lifts straight up on top of that. */
	private layoutCards(): void {
		this.cards.forEach((card, i) => {
			if (card === this.draggingCard) return;

			const isHighlighted = i === this.highlightedIndex && this.selecting;
			card.view.rotation = 0;
			card.view.x = i * CARD_STEP * this.splayProgress;
			card.view.y = isHighlighted ? -HIGHLIGHT_LIFT : 0;
			card.view.alpha = this.splayProgress;
			card.view.scale.set(1);
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
