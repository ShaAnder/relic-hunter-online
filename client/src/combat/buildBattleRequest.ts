import * as RH from "@relic-hunter/shared";
import type { PilotedMercenary, MonsterEntity } from "@/types/entities";
import type { BattleRequest, BattleTutorialOptions, BattleHostResult } from "./BattleHost";
import type { LocalHumanRole } from "@/ui/overlay/BattleOverlay";

/** Everything buildBattleRequest needs to know about one side of a fight. */
export interface CombatantDescriptor {
	state: RH.MercenaryState;
	color: number;
	label: string;
	archetype: RH.AiArchetype;
	isMonster: boolean;
	isLocal: boolean;
	coord: RH.GridCoord;
}

export function describeLocalPlayer(unit: PilotedMercenary): CombatantDescriptor {
	return {
		state: unit.state,
		color: 0x4a9eff,
		label: "You",
		archetype: "balanced",
		isMonster: false,
		isLocal: true,
		coord: unit.state.coord,
	};
}

export function describeAiHunter(unit: PilotedMercenary): CombatantDescriptor {
	return {
		state: unit.state,
		color: RH.ARCHETYPE_COLORS[unit.archetype!],
		label: unit.state.name,
		archetype: unit.archetype ?? "balanced",
		isMonster: false,
		isLocal: false,
		coord: unit.state.coord,
	};
}

/** Either hunter kind — dispatches on pilot so callers don't need their own local/AI branch. */
export function describeHunter(unit: PilotedMercenary): CombatantDescriptor {
	return unit.pilot === "local" ? describeLocalPlayer(unit) : describeAiHunter(unit);
}

export function describeMonster(monster: MonsterEntity): CombatantDescriptor {
	const tierLabel = `${monster.state.tier[0].toUpperCase()}${monster.state.tier.slice(1)} Monster`;
	return {
		state: RH.monsterAsMercenaryState(monster.state),
		color: 0x8b0000,
		label: tierLabel,
		archetype: "balanced",
		isMonster: true,
		isLocal: false,
		coord: monster.state.coord,
	};
}

export interface BuildBattleRequestOptions {
	isRangedInitiated?: boolean;
	maxRounds?: number;
	tutorial?: BattleTutorialOptions;
	onComplete?: (result: BattleHostResult) => void;
	/** Escape hatch — every current call site derives correctly from isLocal, but this stays overridable. */
	localHumanRoleOverride?: LocalHumanRole;
}

/**
 * Combines two descriptors into a BattleRequest. localHumanRole,
 * colors, labels, and monster flags all come from the descriptors —
 * MapScene never computes an archetype-color lookup or formats a
 * tier label itself.
 * @author ShaAnder
 */
export function buildBattleRequest(
	attacker: CombatantDescriptor,
	defender: CombatantDescriptor,
	options: BuildBattleRequestOptions = {},
): BattleRequest {
	const localHumanRole: LocalHumanRole =
		options.localHumanRoleOverride ??
		(attacker.isLocal ? "attacker" : defender.isLocal ? "defender" : "none");

	return {
		attackerState: attacker.state,
		defenderState: defender.state,

		attackerColor: attacker.color,
		attackerLabel: attacker.label,
		defenderColor: defender.color,
		defenderLabel: defender.label,

		attackerArchetype: attacker.archetype,
		defenderArchetype: defender.archetype,

		localHumanRole,

		attackerMapCoord: attacker.coord,
		defenderMapCoord: defender.coord,

		isRangedInitiated: options.isRangedInitiated,
		isAttackerMonster: attacker.isMonster,
		isDefenderMonster: defender.isMonster,

		maxRounds: options.maxRounds,
		tutorial: options.tutorial,
		onComplete: options.onComplete,
	};
}
