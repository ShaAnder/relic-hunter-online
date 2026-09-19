import { describe, expect, it } from "vitest";
import { Grid } from "../../world/grid";
import type { MercenaryStats } from "../../types/mercenary";
import { getZocStepPenalty, type ThreatOwner } from "../zocPathing";

describe("ZoC pathing policy", () => {
	const moverStats: MercenaryStats = {
		movement: 4,
		attack: 3,
		defense: 1,
		maxHp: 10,
		ap: 3,
	};
	const ownerStats: MercenaryStats = {
		movement: 4,
		attack: 10,
		defense: 2,
		maxHp: 10,
		ap: 3,
	};
	it("adds positive policy cost when entering a threatened tile", () => {
		const grid = new Grid(3, 1);
		const owners: ThreatOwner[] = [
			{
				id: "enemy",
				coord: {
					x: 2,
					y: 0,
				},
				zocRadius: 1,
				stats: ownerStats,
			},
		];
		expect(
			getZocStepPenalty(
				grid,
				owners,
				{
					x: 1,
					y: 0,
				},
				moverStats,
				"balanced",
			),
		).toBeGreaterThan(0);
	});
	it("adds no policy cost outside all zones", () => {
		const grid = new Grid(4, 1);
		const owners: ThreatOwner[] = [
			{
				id: "enemy",
				coord: {
					x: 3,
					y: 0,
				},
				zocRadius: 1,
				stats: ownerStats,
			},
		];
		expect(
			getZocStepPenalty(
				grid,
				owners,
				{
					x: 0,
					y: 0,
				},
				moverStats,
				"balanced",
			),
		).toBe(0);
	});
});
