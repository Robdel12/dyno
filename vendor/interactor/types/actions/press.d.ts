/**
 * @param {(string | string[])} keys
 * @param {Object} [options]
 * @param {boolean} [options.hold]
 * @param {boolean} [options.replace]
 * @param {number | [number] | [number, number]} [options.range]
 * @returns {import('../context').ContextGenerator<{ keyboard?: Keyboard }>}
 */
export function press(keys: (string | string[]), options?: {
    hold?: boolean;
    replace?: boolean;
    range?: number | [number] | [number, number];
}): import("../context").ContextGenerator<{
    keyboard?: Keyboard;
}>;
export default press;
import Keyboard from '../keyboard.js';
