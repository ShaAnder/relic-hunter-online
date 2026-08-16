/**
 * Primative dice driven system everything runs through, right now it's wired to
 * traps, later combat / movement. Nothing domain specific belongs here
 */
export function rollDie(sides: number): number {
	return Math.floor(Math.random() * sides) + 1;
}
