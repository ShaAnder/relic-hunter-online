import type { RandomFn } from "./random";

/**
 * Primative dice driven system everything runs through, right now it's wired to
 * traps, later combat / movement. Nothing domain specific belongs here
 */
export function rollDie(sides: number, rng: RandomFn): number {
	return Math.floor(rng() * sides) + 1;
}
