import { Container } from "pixi.js";
import { Card, CardData } from "../entities/Card";

export class Hand {
	readonly view = new Container();
	private cards: Card[] = [];
	private onCardPlayed?: (card: CardData) => void;

	constructor(onCardPlayed?: (card: CardData) => void) {
		this.onCardPlayed = onCardPlayed;
	}

	initStarterHand(): void {
		this.clear();

		const starterCards: CardData[] = [
			{
				id: "blue1",
				color: "blue",
				name: "Move +3",
				value: 3,
				description: "+3 Movement",
				actionType: "move",
			},
			{
				id: "red1",
				color: "red",
				name: "Attack +5",
				value: 5,
				description: "+5 Attack",
				actionType: "attack",
			},
			{
				id: "yellow1",
				color: "yellow",
				name: "Def +4",
				value: 4,
				description: "+4 Defense",
				actionType: "defense",
			},
			{
				id: "green1",
				color: "green",
				name: "Stun",
				value: 1,
				description: "Stun",
				actionType: "stun",
			},
		];

		starterCards.forEach((data, i) => {
			const card = new Card(data);
			card.view.x = i * 90;
			this.cards.push(card);
			this.view.addChild(card.view);

			// click handler
			card.view.eventMode = "static";
			card.view.on("pointerdown", () => {
				this.onCardPlayed?.(data);
			});
		});
	}
	private clear(): void {
		this.cards.forEach((c) => c.view.removeFromParent());
		this.cards = [];
	}

	/** Position the hand at the bottom center */
	resize(width: number, height: number): void {
		this.view.x = width / 2 - (this.cards.length * 90) / 2;
		this.view.y = height - 140;
	}

	getCards(): Card[] {
		return this.cards;
	}

	// setMoveMode(active: boolean): void {
	// 	this.cards.forEach((card) => {
	// 		const data = card.getData();
	// 		const isViableCard =
	// 			data.actionType === "move" ||
	// 			data.actionType === "defense" ||
	// 			data.actionType === "stun";

	// 		// grey out non viable cards
	// 		card.view.alpha = active && !isViableCard ? 0.4 : 1;
	// 		card.view.eventMode = active && !isViableCard ? "none" : "static";

	// 		// visual cue
	// 		card.setSelected(active && isViableCard);
	// 	});
	// }
	// /** Reset all cards to normal state */
	// resetCardStates(): void {
	// 	this.cards.forEach((card) => {
	// 		card.view.alpha = 1;
	// 		card.view.eventMode = "static";
	// 		card.setSelected(false);
	// 	});
	// }
}
