import { Container, Graphics, Text } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import type { CardData } from "@relic-hunter/shared";
import { Card, CARD_WIDTH, CARD_HEIGHT } from "@/entities/Card";

const CARET_PULSE_SPEED = 0.006;
const CARET_PULSE_RANGE = 6;
const OVERLAY_DURATION_MS = 1500;

// Straight-line layout — no more fan rotation/arc
const HAND_CARD_SCALE = 0.65; // smaller cards, Card's own base size is untouched elsewhere
const CARD_GAP = 14;
const HIGHLIGHT_LIFT = 22; // px the selected/hovered card rises straight up
const CARET_GAP = 14;

const REVEALED_Y_OFFSET = -30;
const HIDDEN_Y_OFFSET = CARD_HEIGHT * HAND_CARD_SCALE - 20;
const HOVER_EASE_MS = 180;

// Play zone — sits above the hand tray, the drag target
const ZONE_WIDTH = 140;
const ZONE_HEIGHT = 100;
const ZONE_Y_OFFSET = -140; // above the resting card row

// Slam sequence timing (Inscryption-style: grow, slam down, vanish)
const SLAM_GROW_MS = 120;
const SLAM_IMPACT_MS = 90;
const SLAM_VANISH_MS = 140;
const SLAM_SCALE = 1.35;

export const SKIP_CARD_ID = "__skip__";

/**
 * Renders the hand as a straight line of small cards above CharacterPanel.
 * Confirming a card (by click, Enter, or dragging it into the play zone)
 * always plays the same grow-slam-vanish sequence before firing the real
 * confirm callback — dragging isn't the only way in, it's just the most
 * satisfying one.
 * @param stage - a screen-spanning interactive container, needed so a
 *   drag can keep tracking the pointer once it moves off the card itself
 * @param onCardConfirmed - fired once a card's slam sequence finishes
 * @author ShaAnder
 */
export class Hand {
	readonly view = new Container();
	private fanContainer = new Container();
	private playZone = new Graphics();
	private playZoneLabel: Text;

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
	private resolved = false; // guards against double-confirm mid-slam

	constructor(
		private stage: Container,
		onCardConfirmed?: (card: CardData) => void,
	) {
		this.onCardConfirmed = onCardConfirmed;

		this.view.addChild(this.fanContainer);
		this.fanContainer.y = HIDDEN_Y_OFFSET;

		this.buildPlayZone();

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

		this.playZoneLabel = new Text({
			text: "Play",
			style: { fill: 0xffffff, fontSize: 12, fontWeight: "bold" },
		});
		this.playZoneLabel.anchor.set(0.5);
		this.playZoneLabel.alpha = 0.5;
	}

	get isSelecting(): boolean {
		return this.selecting;
	}

	setHovered(isHovered: boolean): void {
		this.isHovered = isHovered;
	}

	/** Rebuild the displayed cards from the real hand — full teardown/rebuild, infrequent, not a hot path. */
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

	/** Keyboard confirm — plays the same slam sequence as a successful drag. */
	confirmHighlighted(): void {
		if (!this.selecting) return;
		if (this.highlightedIndex < 0 || this.highlightedIndex >= this.cards.length)
			return;
		void this.playCard(this.cards[this.highlightedIndex]);
	}

	update(deltaTime: number): void {
		const deltaMs = (deltaTime / 60) * 1000;

		const targetY =
			this.isHovered || this.forceRevealed
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

		if (this.overlayTimerMs > 0) {
			this.overlayTimerMs -= deltaMs;
			if (this.overlayTimerMs <= 0) {
				this.overlayBg.visible = false;
				this.overlayText.visible = false;
			}
		}
	}

	/** Positioned above CharacterPanel — the hand no longer anchors to the full screen's bottom-center. */
	resize(characterX: number, characterY: number): void {
		this.view.x = characterX + 160; // roughly centered above the panel's width
		this.view.y = characterY - 20;
		this.playZone.x = this.playZoneLabel.x = 0;
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

	/** Click starts a drag attempt — a plain click-and-release with no real movement still counts as a confirm. */
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

		this.stage.on("pointermove", this.onDragMove);
		this.stage.on("pointerup", this.onDragEnd);
		this.stage.on("pointerupoutside", this.onDragEnd);
	}

	private onDragMove = (event: FederatedPointerEvent): void => {
		if (!this.draggingCard) return;
		const localPos = this.fanContainer.toLocal(event.global);
		this.draggingCard.view.x = localPos.x + this.dragOffset.x;
		this.draggingCard.view.y = localPos.y + this.dragOffset.y;
	};

	private onDragEnd = (): void => {
		if (!this.draggingCard) return;
		this.stage.off("pointermove", this.onDragMove);
		this.stage.off("pointerup", this.onDragEnd);
		this.stage.off("pointerupoutside", this.onDragEnd);

		const card = this.draggingCard;
		this.draggingCard = null;

		if (this.isOverPlayZone(card)) {
			void this.playCard(card);
		} else {
			this.layoutCards(); // snaps back to its resting slot
		}
	};

	private isOverPlayZone(card: Card): boolean {
		const dx = card.view.x - this.playZone.x;
		const dy = card.view.y - (this.playZone.y + ZONE_HEIGHT / 2);
		return Math.abs(dx) < ZONE_WIDTH / 2 && Math.abs(dy) < ZONE_HEIGHT / 2;
	}

	/**
	 * Grow → slam into the zone center → vanish, then fire the real
	 * confirm callback. Same sequence regardless of how it was triggered
	 * (drag, click, or Enter) — the visual payoff isn't drag-exclusive.
	 * First-pass timing (~350ms total), not tuned against a real render.
	 */
	private async playCard(card: Card): Promise<void> {
		if (this.resolved) return;
		this.resolved = true;

		const data = card.getData();
		this.showPlayedOverlay(data);
		card.setInteractive(false);

		const startX = card.view.x;
		const startY = card.view.y;
		const zoneCenterX = this.playZone.x;
		const zoneCenterY = this.playZone.y + ZONE_HEIGHT / 2;

		await this.tween(SLAM_GROW_MS, (t) => {
			const s = HAND_CARD_SCALE + (SLAM_SCALE - HAND_CARD_SCALE) * t;
			card.view.scale.set(s);
		});

		await this.tween(SLAM_IMPACT_MS, (t) => {
			card.view.x = startX + (zoneCenterX - startX) * t;
			card.view.y = startY + (zoneCenterY - startY) * t;
		});

		await this.tween(SLAM_VANISH_MS, (t) => {
			card.view.alpha = 1 - t;
			card.view.scale.set(SLAM_SCALE * (1 - t * 0.3));
		});

		this.onCardConfirmed?.(data);
		this.exitSelectionMode();
	}

	/** Simple linear tween helper — runs a callback from t=0 to t=1 over `ms`, resolving when done. */
	private tween(ms: number, onStep: (t: number) => void): Promise<void> {
		return new Promise((resolve) => {
			const start = performance.now();
			const frame = (): void => {
				const t = Math.min(1, (performance.now() - start) / ms);
				onStep(t);
				if (t < 1) requestAnimationFrame(frame);
				else resolve();
			};
			requestAnimationFrame(frame);
		});
	}

	private applyHighlight(): void {
		this.cards.forEach((card, i) =>
			card.setHighlighted(i === this.highlightedIndex),
		);
		this.layoutCards();
	}

	/** Straight-line layout — no rotation, no arc. Highlighted card lifts straight up. */
	private layoutCards(): void {
		const n = this.cards.length;
		if (n === 0) return;

		const cardWidth = CARD_WIDTH * HAND_CARD_SCALE;
		const step = cardWidth + CARD_GAP;
		const totalWidth = step * (n - 1);
		const startX = -totalWidth / 2;

		this.cards.forEach((card, i) => {
			if (card === this.draggingCard) return; // dragged card ignores layout until dropped

			const isHighlighted = i === this.highlightedIndex && this.selecting;
			card.view.rotation = 0;
			card.view.x = startX + i * step;
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

	/** The drop target — sits above the resting card row. */
	private buildPlayZone(): void {
		this.playZone.roundRect(
			-ZONE_WIDTH / 2,
			ZONE_Y_OFFSET,
			ZONE_WIDTH,
			ZONE_HEIGHT,
			10,
		);
		this.playZone.fill({ color: 0xffffff, alpha: 0.06 });
		this.playZone.stroke({ width: 2, color: 0xffd700, alpha: 0.5 });
		this.fanContainer.addChild(this.playZone);
		this.playZone.y = ZONE_Y_OFFSET;

		this.playZoneLabel.y = ZONE_Y_OFFSET + ZONE_HEIGHT / 2;
		this.fanContainer.addChild(this.playZoneLabel);
	}

	private showPlayedOverlay(data: CardData): void {
		this.overlayText.text = `${data.name}\n${data.description}`;
		this.overlayText.x = 0;
		this.overlayText.y = ZONE_Y_OFFSET - 60;
		this.overlayText.visible = true;

		const bounds = this.overlayText.getLocalBounds();
		this.overlayBg.clear();
		this.overlayBg.roundRect(
			this.overlayText.x - bounds.width / 2 - 10,
			this.overlayText.y - 6,
			bounds.width + 20,
			bounds.height + 12,
			6,
		);
		this.overlayBg.fill({ color: 0x000000, alpha: 0.75 });
		this.overlayBg.visible = true;

		this.overlayTimerMs = OVERLAY_DURATION_MS;
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
