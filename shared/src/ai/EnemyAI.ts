import type { GridCoord } from "../game/grid";
import type { MercenaryStats } from "../types/mercenary";
import type { CardData } from "../game/card";
import { CombatAction, CombatChoice } from "../game/combat";

export interface ChestInfo {
	coord: GridCoord;
	isOpen: boolean;
}

/** Manhattan distance — matches this grid's real movement cost (cardinal-only, no diagonals). */
function manhattanDistance(a: GridCoord, b: GridCoord): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Balanced archetype's movement target: the player if they carry the match
 * target, otherwise whichever is closer — the player or the nearest
 * unopened chest. Genuinely opportunistic, not a beeline.
 * @author ShaAnder
 */
export function decideMovementTarget(
	enemyCoord: GridCoord,
	playerCoord: GridCoord,
	playerCarriesTarget: boolean,
	chests: ChestInfo[],
): GridCoord {
	if (playerCarriesTarget) return playerCoord;

	const distToPlayer = manhattanDistance(enemyCoord, playerCoord);

	let nearestChest: GridCoord | null = null;
	let nearestChestDist = Infinity;
	for (const chest of chests) {
		if (chest.isOpen) continue;
		const dist = manhattanDistance(enemyCoord, chest.coord);
		if (dist < nearestChestDist) {
			nearestChestDist = dist;
			nearestChest = chest.coord;
		}
	}

	if (nearestChest && nearestChestDist < distToPlayer) return nearestChest;
	return playerCoord;
}

/**
 * Whether it's worth engaging: HP ratio (40%), opponent's item count as a
 * loot incentive (30%), and rough combat-power ratio (30%). Engage at
 * score ≥ 0.5. A first-pass formula, not claimed-tuned — needs real
 * playtesting.
 */
export function decideEngagement(
	ownStats: MercenaryStats,
	ownCurrentHp: number,
	opponentStats: MercenaryStats,
	opponentItemCount: number,
): boolean {
	const hpRatio = ownCurrentHp / ownStats.maxHp;
	const itemScore = Math.min(1, opponentItemCount / 6);

	const ownPower = ownStats.attack + ownStats.defense + ownStats.movement;
	const oppPower =
		opponentStats.attack + opponentStats.defense + opponentStats.movement;
	const powerRatio = Math.min(2, ownPower / Math.max(1, oppPower)) / 2;

	const score = hpRatio * 0.4 + itemScore * 0.3 + powerRatio * 0.3;
	return score >= 0.5;
}

/** Relative strength for picking the best available card — specials outrank numerics. */
function cardStrength(card: CardData): number {
	if (card.value === "A") return 100;
	if (card.value === "C") return 90;
	return typeof card.value === "number" ? card.value : 0;
}

/**
 * In-combat choice: random Attack/Defend, then the strongest available
 * card of the matching color (Red for Attack, Yellow for Defend), or none
 * if the hand has nothing usable. Run/Surrender aren't part of AI
 * decision-making yet.
 */
export function chooseCombatAction(
	hand: CardData[],
	stats: MercenaryStats,
): CombatChoice {
	const action: CombatAction = Math.random() < 0.5 ? "attack" : "defend";
	const wantedColor = action === "attack" ? "red" : "yellow";

	const candidates = hand.filter((c) => c.color === wantedColor);
	const best = candidates.length
		? candidates.reduce((a, b) => (cardStrength(b) > cardStrength(a) ? b : a))
		: undefined;

	return { action, stats, card: best };
}
