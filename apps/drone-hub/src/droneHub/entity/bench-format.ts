/** Small formatting shared by the bench's panes. */

/** The keypad's keys in the order the bench lays them out. */
export const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Session time with two decimals, e.g. "12.34s". */
export const seconds = (t: number) => `${(t / 1000).toFixed(2)}s`;
