import type { Container } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import { MonsterToken } from "@/entities/Monster";
import type { MonsterEntity } from "@/types/entities";

/**
 * Owns monster lifecycle — spawning, the boss, removal on death. Takes
 * an already-chosen spawn coord rather than picking one itself, since
 * that positioning logic is shared with hunter/boss spawning elsewhere
 * on MapScene, not monster-specific.
 * @author ShaAnder
 */
export class MonsterSystem {
	private monsters: MonsterEntity[] = [];
	private boss: MonsterEntity | null = null;
	private monsterSpawnIndex = 0;

	private static readonly MONSTER_TIERS: RH.MonsterTier[] = [
		"light",
		"medium",
		"heavy",
	];

	constructor(private mercenaryContainer: Container) {}

	get all(): readonly MonsterEntity[] {
		return this.monsters;
	}

	/**
	 * Clears the roster for a fresh map — caller (regenerateMap) already
	 * wipes the visual container separately, this just resets the data
	 * so shouldSpawn() doesn't stay permanently capped from a previous
	 * map's monster count.
	 */
	reset(): void {
		this.monsters = [];
		this.boss = null;
		this.monsterSpawnIndex = 0;
	}

	get bossEntity(): MonsterEntity | null {
		return this.boss;
	}

	livingMonsters(): MonsterEntity[] {
		return this.monsters.filter((m) => m.state.currentHp > 0);
	}

	livingMonsterCoords(): RH.GridCoord[] {
		return this.livingMonsters().map((m) => m.state.coord);
	}

	/** Every monster's coord, living or not — for spawn-tile exclusion sets. */
	occupiedCoordKeys(): string[] {
		return this.monsters.map((m) => RH.coordKey(m.state.coord));
	}

	/** Cheap pre-check — call before doing any expensive spawn-tile search. */
	shouldSpawn(): boolean {
		return RH.shouldSpawnMonster(this.monsters.length);
	}

	/** Spawns the next-tier monster at coord. Returns the tier spawned, or null if shouldSpawn() would now say no. */
	trySpawn(coord: RH.GridCoord): RH.MonsterTier | null {
		if (!this.shouldSpawn()) return null;

		const tier =
			MonsterSystem.MONSTER_TIERS[
				this.monsterSpawnIndex % MonsterSystem.MONSTER_TIERS.length
			];
		this.monsterSpawnIndex++;

		const state = RH.createMonster(
			`monster_${Date.now()}_${this.monsterSpawnIndex}`,
			tier,
			coord,
		);
		const token = new MonsterToken(coord, tier);
		this.mercenaryContainer.addChild(token.view);

		const entity: MonsterEntity = { state, token };
		this.monsters.push(entity);
		return tier;
	}

	/** Spawns the boss at coord — always succeeds, no shouldSpawn gate (checkDeckExhaustion decides when this fires). */
	spawnBoss(coord: RH.GridCoord): MonsterEntity {
		const state = RH.createMonster(`boss_${Date.now()}`, "boss", coord);
		const token = new MonsterToken(coord, "boss");
		this.mercenaryContainer.addChild(token.view);

		const entity: MonsterEntity = { state, token };
		this.boss = entity;
		this.monsters.push(entity);
		return entity;
	}

	/** Always-succeeds spawn with an explicit id/tier — the tutorial's single, controlled monster, not part of the normal rotation. */
	spawnSpecific(
		id: string,
		tier: RH.MonsterTier,
		coord: RH.GridCoord,
	): MonsterEntity {
		const state = RH.createMonster(id, tier, coord);
		const token = new MonsterToken(coord, tier);
		this.mercenaryContainer.addChild(token.view);

		const entity: MonsterEntity = { state, token };
		this.monsters.push(entity);
		return entity;
	}

	/** Removes a dead monster from the board entirely — array entry and visual token both, not just letting HP sit at 0 forever. */
	remove(monster: MonsterEntity): void {
		const index = this.monsters.indexOf(monster);
		if (index !== -1) this.monsters.splice(index, 1);
		if (monster === this.boss) this.boss = null;
		this.mercenaryContainer.removeChild(monster.token.view);
		monster.token.view.destroy({ children: true });
	}
}
