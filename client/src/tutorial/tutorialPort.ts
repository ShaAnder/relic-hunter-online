import type { CardData, GridCoord, MonsterTier, CombatAction } from "@relic-hunter/shared";
import type { DialogueLine } from "./dialogue";
import type { TutorialUiPointerTarget } from "./tutorialTypes";

/** Callbacks for one guided combat round. */
export interface TutorialCombatGuide {
	requiredAction: CombatAction;
	grayOthers?: boolean;
	onWrongAction?: () => void | Promise<void>;
	onReady?: () => void | Promise<void>;
}

/**
 * Everything a tutorial needs from wherever it's actually running.
 * TutorialRunner only ever sees this — never MapScene directly.
 * @author ShaAnder
 */
export interface TutorialPort {
	playDialogue(lines: DialogueLine[]): Promise<void>;
	setHudVisible(visible: boolean): void;

	getLocalUnitCoord(): GridCoord;
	resetLocalUnitToCoord(coord: GridCoord): void;
	clearLocalHand(): void;
	giveCard(card: CardData): void;
	giveCards(cards: CardData[]): void;

	showTutorialTarget(coord: GridCoord): void;
	hideTutorialTarget(): void;
	showUiPointer(target: TutorialUiPointerTarget): void;
	hideUiPointer(): void;

	moveStaticActor(
		label: string,
		destination: GridCoord,
		durationMs?: number,
	): Promise<void>;
	spawnTutorialMonster(coord: GridCoord, tier: MonsterTier): void;
	getTutorialMonsterCoord(): GridCoord | null;
	dashMonsterToPlayer(): Promise<void>;
	triggerTutorialMonsterAttack(
		maxRounds?: number,
		availableActions?: CombatAction[],
		guide?: TutorialCombatGuide,
	): Promise<void>;
}
