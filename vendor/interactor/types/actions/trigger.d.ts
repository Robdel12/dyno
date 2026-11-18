/**
 * @param {string} eventName
 * @param {{
 *   bubbles?: boolean,
 *   cancelable?: boolean,
 *   [key: string]: any
 * }} [options]
 * @returns {import('../context').ContextGenerator<any, boolean>}
 */
export function trigger(eventName: string, { bubbles, cancelable, ...eventProperties }?: {
    bubbles?: boolean;
    cancelable?: boolean;
    [key: string]: any;
}): import("../context").ContextGenerator<any, boolean>;
export default trigger;
