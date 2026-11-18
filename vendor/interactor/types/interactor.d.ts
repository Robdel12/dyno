export class Interactor {
    static Assert: typeof Assert;
    static Assertion: typeof Assertion;
    static Context: typeof Context;
    static Interaction: typeof Interaction;
    /**
     * @param {string} name
     * @param {(
     *   (new (...args: any) => Interaction) |
     *   ((...args: any) => import('./context').ContextYield)
     * )} action
     * @returns {typeof Interactor}
     */
    static defineAction(name: string, action: ((new (...args: any) => Interaction) | ((...args: any) => import("./context").ContextYield))): typeof Interactor;
    /**
     * @param {{
     *   [name: string]:
     *     (new (...args: any[]) => Interaction) |
     *     ((...args: any[]) => import('./context').ContextYield)
     * }} interactions
     * @returns {typeof Interactor}
     */
    static defineActions(interactions: {
        [name: string]: (new (...args: any[]) => Interaction) | ((...args: any[]) => import("./context").ContextYield);
    }): typeof Interactor;
    /**
     * @overload
     * @param {string} name
     * @param {(
     *   (new (...args: any[]) => Assertion) |
     *   ((...args: any[]) => AssertSubject) |
     *   AssertObject
     * )} assertion
     * @returns {typeof Interactor}
     */
    static defineAssertion(name: string, assertion: ((new (...args: any[]) => Assertion) | ((...args: any[]) => boolean | void | import("./context.js").ContextFunction<{}, any>) | {
        assertion: (context: Context<{}>) => any;
        failureMessage?: import("./assertion.js").AssertMessage;
        negatedMessage?: import("./assertion.js").AssertMessage;
    })): typeof Interactor;
    /**
     * @overload
     * @param {string} name
     * @param {(...args: any[]) => AssertSubject} assertion
     * @param {AssertMessage} [failureMessage]
     * @param {AssertMessage} [negatedMessage]
     * @returns {typeof Interactor}
     */
    static defineAssertion(name: string, assertion: (...args: any[]) => boolean | void | import("./context.js").ContextFunction<{}, any>, failureMessage?: import("./assertion.js").AssertMessage, negatedMessage?: import("./assertion.js").AssertMessage): typeof Interactor;
    /**
     * @param {{
     *   [name: string]:
     *     (new (...args: any[]) => Assertion) |
     *     ((...args: any[]) => AssertSubject) |
     *     AssertObject
     * }} assertions
     * @returns {typeof Interactor}
     */
    static defineAssertions(assertions: {
        [name: string]: (new (...args: any[]) => Assertion) | ((...args: any[]) => boolean | void | import("./context.js").ContextFunction<{}, any>) | {
            assertion: (context: Context<{}>) => any;
            failureMessage?: import("./assertion.js").AssertMessage;
            negatedMessage?: import("./assertion.js").AssertMessage;
        };
    }): typeof Interactor;
    /**
     * @type {{
     *   [name: string]:
     *     (new (...args: any[]) => Assertion) |
     *     ((...args: any[]) => AssertSubject) |
     *     AssertObject
     * }}
     */
    static assert: {
        [name: string]: (new (...args: any[]) => Assertion) | ((...args: any[]) => boolean | void | import("./context.js").ContextFunction<{}, any>) | {
            assertion: (context: Context<{}>) => any;
            failureMessage?: import("./assertion.js").AssertMessage;
            negatedMessage?: import("./assertion.js").AssertMessage;
        };
    };
    /**
     * @param {ConstructorParameters<typeof Context>[1]} [options]
     */
    constructor(options?: ConstructorParameters<typeof Context>[1]);
    /**
     * @param {import('./context').ContextFunction} callback
     * @returns {import('./chainable').Chainable<Arrangement, Interactor, any>}
     */
    arrange(callback: import("./context").ContextFunction): import("./chainable").Chainable<Arrangement, Interactor, any>;
    /**
     * @template {(Interaction | import('./context').ContextFunction)} T
     * @param {T} interaction
     * @returns {(
     *   T extends import('./context').ContextFunction<any, infer R> ?
     *     import('./chainable').Chainable<Interaction, Interactor, R> :
     *   T extends Interaction<infer R> ?
     *     import('./chainable').Chainable<T, Interactor, R> :
     *   never
     * )}
     */
    act<T extends (Interaction | import("./context").ContextFunction)>(interaction: T): (T extends import("./context").ContextFunction<any, infer R> ? import("./chainable").Chainable<Interaction, Interactor, R> : T extends Interaction<infer R> ? import("./chainable").Chainable<T, Interactor, R> : never);
    /**
     * @type {(Assert & (
     *   ((assertion: import('./context').ContextYield, failureMessage?: string) =>
     *     import('./chainable').Chainable<Assertion, Interactor, boolean>) &
     *   (<T extends Assertion>(assertion: T) =>
     *     import('./chainable').Chainable<T, Interactor, boolean>)
     * ))}
     */
    get assert(): (Assert & (((assertion: import("./context").ContextYield, failureMessage?: string) => import("./chainable").Chainable<Assertion, Interactor, boolean>) & (<T extends Assertion>(assertion: T) => import("./chainable").Chainable<T, Interactor, boolean>)));
    /**
     * @template [T = {}]
     * @typedef {import('./context').ContextOptions<T>} ContextOptions
     */
    /**
     * @param {ContextOptions['selector']} [selector]
     * @returns {import('./chainable').Chainable<Assert & {
     *   times(number: number): import('./chainable').Chainable<Assertion, Interactor, boolean>
     * }, Interactor, HTMLElement>}
     */
    find(selector?: import("./selector.js").SelectorInput): import("./chainable").Chainable<Assert & {
        times(number: number): import("./chainable").Chainable<Assertion, Interactor, boolean>;
    }, Interactor, HTMLElement>;
    blur: (selector?: import("./selector.js").SelectorInput) => import("./chainable.js").Chainable<Interaction<any>, Interactor, import("./context.js").ContextGenerator<{}, any>>;
    click: (selector?: import("./selector.js").SelectorInput) => import("./chainable.js").Chainable<Interaction<any>, Interactor, import("./context.js").ContextGenerator<{}, any>>;
    focus: (selector?: import("./selector.js").SelectorInput) => import("./chainable.js").Chainable<Interaction<any>, Interactor, import("./context.js").ContextGenerator<{}, any>>;
    press: (keys: string | string[], options?: {
        hold?: boolean;
        replace?: boolean;
        range?: number | [number] | [number, number];
    }) => import("./chainable.js").Chainable<Interaction<any>, Interactor, import("./context.js").ContextGenerator<{
        keyboard?: import("./keyboard.js").Keyboard;
    }, any>>;
    trigger: (eventName: string, args_1?: {
        [key: string]: any;
        bubbles?: boolean;
        cancelable?: boolean;
    }) => import("./chainable.js").Chainable<Interaction<any>, Interactor, import("./context.js").ContextGenerator<any, boolean>>;
    type: (string: string, options?: {
        delay?: number;
        replace?: boolean;
        range?: (number | [number, number]);
    }) => import("./chainable.js").Chainable<import("./actions/type.js").TypeAction, Interactor, unknown>;
    wait: (timeout: number) => import("./chainable.js").Chainable<Interaction<any>, Interactor, import("./context.js").ContextGenerator<{}, any>>;
}
export default Interactor;
import Arrangement from './arrangement.js';
import Interaction from './interaction.js';
import Assert from './assert.js';
import Assertion from './assertion.js';
import Context from './context.js';
