/**
 * @param {string} string
 * @param {Object} [options]
 * @param {number} [options.delay]
 * @param {boolean} [options.replace]
 * @param {(number | [number, number])} [options.range]
 * @returns {import('../context').ContextGenerator}
 */
export function type(string: string, options?: {
    delay?: number;
    replace?: boolean;
    range?: (number | [number, number]);
}): import("../context").ContextGenerator;
export class TypeAction extends Interaction<any> {
    /** @param {Parameters<type>} args */
    constructor(string: string, options?: {
        delay?: number;
        replace?: boolean;
        range?: (number | [number, number]);
    });
    /** @param {import('../context').ContextOptions['selector']} selector */
    into(selector: import("../context").ContextOptions["selector"]): this;
}
export default TypeAction;
import Interaction from '../interaction';
