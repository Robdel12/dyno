/**
 * @template {{}} [T = {}]
 * @template [TReturn = any]
 * @typedef {(
 *   (context: IContext<T>) => ContextYield<TReturn> | TReturn
 * )} ContextFunction
 */
/**
 * @template [T = any]
 * @template {{}} [C = {}]
 * @typedef {(
 *   ContextGenerator<C, T> | ContextFunction<C, T> | T |
 *   string | number | boolean | undefined | null | void |
 *   any[] | { [key: string]: any }
 * )} ContextYield
 */
/**
 * @template {{}} [T = {}]
 * @template {any} [TReturn = any]
 * @typedef {(Generator<
 *   ContextYield<TReturn, T>,
 *   ContextYield<TReturn, T>, any
 * >)} ContextGenerator
 */
/**
 * @template {{}} [T = {}]
 * @typedef {T & {
 *   [key: string]: any
 *   root?: () => HTMLElement
 *   selector?: import('./selector').SelectorInput
 *   immediate?: ContextOptions<T>
 *   assert?: {
 *     expected?: boolean
 *     timeout?: number
 *     frequency?: number
 *     reliability?: number
 *   }
 * }} ContextOptions
 */
/**
 * @template {{}} [T = {}]
 * @typedef {Context<T> & T} IContext
 */
/**
 * @template {{}} [T = {}]
 */
export class Context<T extends {} = {}> {
    static Symbol: symbol;
    /**
     * @overload
     * @param {Context<T>} i
     */
    constructor(i: Context<T>);
    /**
     * @overload
     * @param {Interactor} i
     * @param {ContextOptions<T>} [options]
     */
    constructor(i: import("./interactor").Interactor, options?: ContextOptions<T>);
    i: import("./interactor").Interactor;
    root: () => HTMLElement;
    assert: {
        timeout: number;
        frequency: number;
        reliability: number;
    };
    immediate: this;
    /** @param {import('./selector').SelectorInput} selector */
    set selector(selector: import("./selector").SelectorInput);
    /** @type {import('./selector').Selector} */
    get selector(): import("./selector").Selector;
    /** @type {HTMLElement} */
    get $(): HTMLElement;
    /** @type {HTMLElement[]} */
    get $$(): HTMLElement[];
    /** @type {(options: ContextOptions<T>) => this} */
    get set(): (options: ContextOptions<T>) => this;
}
export default Context;
export type ContextFunction<T extends {} = {}, TReturn = any> = ((context: IContext<T>) => ContextYield<TReturn> | TReturn);
export type ContextYield<T = any, C extends {} = {}> = (ContextGenerator<C, T> | ContextFunction<C, T> | T | string | number | boolean | undefined | null | void | any[] | {
    [key: string]: any;
});
export type ContextGenerator<T extends {} = {}, TReturn extends unknown = any> = (Generator<ContextYield<TReturn, T>, ContextYield<TReturn, T>, any>);
export type ContextOptions<T extends {} = {}> = T & {
    [key: string]: any;
    root?: () => HTMLElement;
    selector?: import("./selector").SelectorInput;
    immediate?: ContextOptions<T>;
    assert?: {
        expected?: boolean;
        timeout?: number;
        frequency?: number;
        reliability?: number;
    };
};
export type IContext<T extends {} = {}> = Context<T> & T;
