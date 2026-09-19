import { describe, expect, it } from "vitest";
import { EdgeMapTileCode, compileEdgeMap } from "../maps/edgeMapCompiler";
import { clampElevationStep, elevationHeightForStep } from "../maps/elevation";
import { normalizeMapBundle } from "../maps/mapBundle";

describe("elevation model", () => {
	it("uses the canonical hard step table", () => {
		expect(elevationHeightForStep(-2)).toBe(-0.2);
		expect(elevationHeightForStep(3)).toBe(0.3);
	});
	it("clamps authored values to supported integer steps", () => {
		expect(clampElevationStep(99)).toBe(10);
		expect(clampElevationStep(-99)).toBe(-10);
	});
	it("gives Road its default -2 step", () => {
		const compiled = compileEdgeMap([[EdgeMapTileCode.Road]]);
		expect(compiled.elevationSteps.get("0,0")).toBe(-2);
		expect(compiled.elevation.get("0,0")).toBe(-0.2);
	});
	it("lets authored elevation override material default", () => {
		const compiled = compileEdgeMap([[EdgeMapTileCode.Road]], {
			"0,0": 3,
		});
		expect(compiled.elevationSteps.get("0,0")).toBe(3);
		expect(compiled.elevation.get("0,0")).toBe(0.3);
	});
	it("normalizes legacy map bundles into canonical floor definitions", () => {
		const normalized = normalizeMapBundle({
			name: "Legacy",
			floors: [[[EdgeMapTileCode.Floor]]],
			groundFloorIndex: 0,
		});
		expect(normalized).not.toBeNull();
		expect(normalized!.floors[0].elevationSteps).toEqual({});
		expect(normalized!.floors[0].blueprint).toEqual([[EdgeMapTileCode.Floor]]);
	});
});
