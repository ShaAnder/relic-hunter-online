// shared/src/game/random.ts

/**
 * Seeded random number generator, using a known recipe called mulberry32.
 * Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 *
 * Give it the same starting number (the "seed") and it always produces the
 * same sequence of results — unlike Math.random(), which is different every run.
 *
 * That's what lets us reproduce the exact same dungeon layout from a seed
 * (great for testing), and later, replay/verify dice rolls and card shuffles.
 *
 * Not secure — fine for game randomness, never for passwords/tokens/payments.
 */

// Fixed number added to our internal counter each call — like advancing a dial
// by the same amount every step. Part of the tested recipe, not something we chose.
const MULBERRY32_INCREMENT = 0x6d2b79f5;

// Control how thoroughly we scramble the number at each stage — each one exposes
// a different set of bits to mix in. Fixed recipe values, not tunable knobs.
const MIX_SHIFT_1 = 15; // round 1
const MIX_SHIFT_2 = 7; // round 2
const MIX_SHIFT_3 = 14; // final pass

// Force a mid-step number to be odd. This is a math trick that keeps the
// scrambling thorough — without it, results could start repeating sooner than they should.
const FORCE_ODD_A = 1; // round 1
const FORCE_ODD_B = 61; // round 2

// Turns the final scrambled whole number into a friendly 0–1 decimal, the same
// range Math.random() returns.
const UINT32_RANGE = 4294967296;

export function createSeededRandom(seed: number): () => number {
	let state = seed;

	return function nextRandom(): number {
		state |= 0;
		state = (state + MULBERRY32_INCREMENT) | 0;

		// We use Math.imul (a special multiply) instead of "*" here — regular JS
		// math starts losing precision at this size, and this needs to be exact
		// or the sequence stops matching the tested recipe.
		let mixed = Math.imul(state ^ (state >>> MIX_SHIFT_1), FORCE_ODD_A | state);
		mixed =
			(mixed +
				Math.imul(mixed ^ (mixed >>> MIX_SHIFT_2), FORCE_ODD_B | mixed)) ^
			mixed;

		return ((mixed ^ (mixed >>> MIX_SHIFT_3)) >>> 0) / UINT32_RANGE;
	};
}
