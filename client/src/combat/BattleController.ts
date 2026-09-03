import {
	resolveCombatRound,
	resolveDefeat,
	resolveSurrender,
} from "@relic-hunter/shared";
import type {
	CombatChoice,
	CombatRoundResult,
	MercenaryState,
	RandomFn,
} from "@relic-hunter/shared";
import type { LocalHumanRole } from "@/ui/overlay/BattleOverlay";

export interface RoundResolution {
	result: CombatRoundResult;
	/** Only meaningful when bothAttacking is true. */
	attackerFirst: boolean;
	bothAttacking: boolean;
	battleOver: boolean;
}

/**
 * One winner/loser or giver/receiver sequence to play, matching
 * BattleOverlay's own runLootSequence/runSurrenderGiveSequence
 * parameter names exactly — deliberately not unified into one shape,
 * since "winner" and "giver" are opposite directions of item flow and
 * forcing them into the same field names risks silently swapping them.
 */
export type LootSequenceRequest =
	| {
			kind: "loot";
			winnerState: MercenaryState;
			loserState: MercenaryState;
			winnerIsLocal: boolean;
			allowSkip: boolean;
	  }
	| {
			kind: "surrenderGive";
			giverState: MercenaryState;
			receiverState: MercenaryState;
			giverIsLocal: boolean;
	  };

export interface BattleEndDecision {
	attackerNeedsTeleport: boolean;
	defenderNeedsTeleport: boolean;
	attackerMonsterDied: boolean;
	defenderMonsterDied: boolean;
	/** 0, 1, or 2 entries — both sides can die in the same round. Play in order. */
	lootSequences: LootSequenceRequest[];
}

/**
 * Pure combat decisions — no Pixi, no animation timing. BattleOverlay
 * calls these, then plays its own presentation sequence around the
 * returned values; the timing of *when* things appear on screen stays
 * entirely with BattleOverlay.
 * @author ShaAnder
 */
export const BattleController = {
	/**
	 * Splices the played cards out of both hands (an immediate, not
	 * animation-timed, consequence of the choice) and computes the
	 * round's result. Deliberately does not apply HP/score changes —
	 * those are timed with BattleOverlay's own reveal animation.
	 */
	resolveRound(
		attackerState: MercenaryState,
		defenderState: MercenaryState,
		attackerChoice: CombatChoice,
		defenderChoice: CombatChoice,
		currentRound: number,
		maxRounds: number,
		rng: RandomFn,
	): RoundResolution {
		if (attackerChoice.card) {
			const idx = attackerState.hand.findIndex(
				(c) => c.id === attackerChoice.card!.id,
			);
			if (idx !== -1) attackerState.hand.splice(idx, 1);
		}
		if (defenderChoice.card) {
			const idx = defenderState.hand.findIndex(
				(c) => c.id === defenderChoice.card!.id,
			);
			if (idx !== -1) defenderState.hand.splice(idx, 1);
		}

		const result = resolveCombatRound(attackerChoice, defenderChoice, rng);
		const bothAttacking =
			attackerChoice.action === "attack" && defenderChoice.action === "attack";

		const battleOver =
			attackerState.currentHp - result.a.damageTaken <= 0 ||
			defenderState.currentHp - result.b.damageTaken <= 0 ||
			attackerChoice.action === "surrender" ||
			defenderChoice.action === "surrender" ||
			result.a.escaped === true ||
			result.b.escaped === true ||
			currentRound >= maxRounds;

		return {
			result,
			// Coin flip only matters when both sides actually attacked —
			// keeping it here (not left to BattleOverlay) means the same
			// function that decides "both attacked" also decides order.
			attackerFirst: bothAttacking ? Math.random() < 0.5 : true,
			bothAttacking,
			battleOver,
		};
	},

	/**
	 * Same branches finishBattle() always had — surrender vs. defeat,
	 * monster vs. non-monster, hpCeiling/item-stolen consequences —
	 * just returning the decision instead of awaiting the visual
	 * sequence directly. BattleOverlay plays whatever lootSequences
	 * says, in order, then hides itself and reports the result.
	 */
	resolveBattleEnd(
		attackerState: MercenaryState,
		defenderState: MercenaryState,
		attackerChoice: CombatChoice,
		defenderChoice: CombatChoice,
		isAttackerMonster: boolean,
		isDefenderMonster: boolean,
		localHumanRole: LocalHumanRole,
	): BattleEndDecision {
		let attackerNeedsTeleport = false;
		let defenderNeedsTeleport = false;
		let attackerMonsterDied = false;
		let defenderMonsterDied = false;
		const lootSequences: LootSequenceRequest[] = [];

		if (
			attackerChoice.action === "surrender" ||
			defenderChoice.action === "surrender"
		) {
			const surrenderer =
				attackerChoice.action === "surrender" ? "attacker" : "defender";
			const giverState =
				surrenderer === "attacker" ? attackerState : defenderState;
			const receiverState =
				surrenderer === "attacker" ? defenderState : attackerState;

			const receiverIsMonster =
				(surrenderer === "attacker" && isDefenderMonster) ||
				(surrenderer === "defender" && isAttackerMonster);

			const consequence = resolveSurrender(
				giverState.items.filter((i) => i !== null).length,
			);
			if (consequence.itemGiven && !receiverIsMonster) {
				const giverIsLocal =
					(surrenderer === "attacker" && localHumanRole === "attacker") ||
					(surrenderer === "defender" && localHumanRole === "defender");
				lootSequences.push({
					kind: "surrenderGive",
					giverState,
					receiverState,
					giverIsLocal,
				});
			}

			if (surrenderer === "attacker") attackerNeedsTeleport = true;
			else defenderNeedsTeleport = true;
		} else {
			if (attackerState.currentHp <= 0) {
				if (isAttackerMonster) {
					attackerMonsterDied = true;
				} else {
					const defeatedByHunter = !isDefenderMonster;
					const consequence = resolveDefeat(
						attackerState.stats,
						defeatedByHunter,
					);
					attackerState.hpCeiling = consequence.hpCeiling;
					if (consequence.itemStolen && defeatedByHunter) {
						lootSequences.push({
							kind: "loot",
							winnerState: defenderState,
							loserState: attackerState,
							winnerIsLocal: localHumanRole === "defender",
							allowSkip: true,
						});
					}
					attackerNeedsTeleport = true;
				}
			}

			if (defenderState.currentHp <= 0) {
				if (isDefenderMonster) {
					defenderMonsterDied = true;
				} else {
					const defeatedByHunter = !isAttackerMonster;
					const consequence = resolveDefeat(
						defenderState.stats,
						defeatedByHunter,
					);
					defenderState.hpCeiling = consequence.hpCeiling;
					if (consequence.itemStolen && defeatedByHunter) {
						lootSequences.push({
							kind: "loot",
							winnerState: attackerState,
							loserState: defenderState,
							winnerIsLocal: localHumanRole === "attacker",
							allowSkip: true,
						});
					}
					defenderNeedsTeleport = true;
				}
			}
		}

		return {
			attackerNeedsTeleport,
			defenderNeedsTeleport,
			attackerMonsterDied,
			defenderMonsterDied,
			lootSequences,
		};
	},
};
