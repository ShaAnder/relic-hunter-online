import * as RH from "@relic-hunter/shared";
import { MonsterToken } from "@/entities/Monster";
import type { DynamicWorldRenderer } from "@/rendering/engine/dynamic/DynamicWorldRenderer";
import type { MonsterEntity } from "@/types/entities";

/**
 * Owns monster gameplay/visual lifetime.
 *
 * DynamicWorldRenderer owns scene attachment + visibility registration.
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

	constructor(
		private readonly dynamicWorld: DynamicWorldRenderer,
		private elevation?: Map<string, number>,
	) {}

	get all(): readonly MonsterEntity[] {
		return this.monsters;
	}

	reset(): void {
		for (const monster of this.monsters) {
			this.dynamicWorld.unregister(monster.state.id);
			monster.token.view.destroy({
				children: true,
			});
		}
		this.monsters = [];
		this.boss = null;
		this.monsterSpawnIndex = 0;
	}
	get bossEntity(): MonsterEntity | null {
		return this.boss;
	}

	livingMonsters(): MonsterEntity[] {
		return this.monsters.filter((monster) => monster.state.currentHp > 0);
	}
	livingMonsterCoords(): RH.GridCoord[] {
		return this.livingMonsters().map((monster) => monster.state.coord);
	}
	occupiedCoordKeys(): string[] {
		return this.monsters.map((monster) => RH.coordKey(monster.state.coord));
	}
	shouldSpawn(rng: RH.RandomFn): boolean {
		return RH.shouldSpawnMonster(this.monsters.length, rng);
	}

	trySpawn(
		coord: RH.GridCoord,
		rng: RH.RandomFn,
		floorIndex = 0,
	): RH.MonsterTier | null {
		if (!this.shouldSpawn(rng)) {
			return null;
		}

		const tier =
			MonsterSystem.MONSTER_TIERS[
				this.monsterSpawnIndex % MonsterSystem.MONSTER_TIERS.length
			];
		this.monsterSpawnIndex += 1;

		const state = RH.createMonster(
			`monster_${Date.now()}_${this.monsterSpawnIndex}`,
			tier,
			coord,
			floorIndex,
		);
		const token = new MonsterToken(coord, tier, this.elevation);
		const entity: MonsterEntity = {
			state,
			token,
		};
		this.monsters.push(entity);
		this.registerDynamicMonster(entity);
		return tier;
	}

	spawnBoss(coord: RH.GridCoord, floorIndex = 0): MonsterEntity {
		const state = RH.createMonster(
			`boss_${Date.now()}`,
			"boss",
			coord,
			floorIndex,
		);
		const token = new MonsterToken(coord, "boss", this.elevation);
		const entity: MonsterEntity = {
			state,
			token,
		};
		this.boss = entity;
		this.monsters.push(entity);
		this.registerDynamicMonster(entity);
		return entity;
	}

	spawnSpecific(
		id: string,
		tier: RH.MonsterTier,
		coord: RH.GridCoord,
		floorIndex = 0,
	): MonsterEntity {
		const state = RH.createMonster(id, tier, coord, floorIndex);
		const token = new MonsterToken(coord, tier, this.elevation);
		const entity: MonsterEntity = {
			state,
			token,
		};
		this.monsters.push(entity);
		this.registerDynamicMonster(entity);
		return entity;
	}

	remove(monster: MonsterEntity): void {
		const index = this.monsters.indexOf(monster);
		if (index !== -1) {
			this.monsters.splice(index, 1);
		}
		if (monster === this.boss) {
			this.boss = null;
		}
		this.dynamicWorld.unregister(monster.state.id);
		monster.token.view.destroy({
			children: true,
		});
	}

	private registerDynamicMonster(entity: MonsterEntity): void {
		this.dynamicWorld.register({
			id: entity.state.id,
			kind: "monster",
			view: entity.token.view,
			renderKind: "procedural",
			lifetime: "stateful",
			getFloorIndex: () => entity.state.floorIndex,
			getCoord: () => entity.state.coord,
		});
	}
}
