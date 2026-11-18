/**
 * @typedef {(string | RegExp | HTMLElement | {
 *   (options: { $root?: HTMLElement, $origin?: HTMLElement }): HTMLElement | HTMLElement[]
 * })} SelectorInput
 */
export class Selector {
    static parse(selector: any): {
        re: RegExp;
        string: string;
        fn?: undefined;
        $?: undefined;
        sel?: undefined;
        text?: undefined;
    } | {
        fn: any;
        string: any;
        re?: undefined;
        $?: undefined;
        sel?: undefined;
        text?: undefined;
    } | {
        $: any;
        string: string;
        re?: undefined;
        fn?: undefined;
        sel?: undefined;
        text?: undefined;
    } | {
        sel: string;
        text: string;
        string: string;
        re?: undefined;
        fn?: undefined;
        $?: undefined;
    };
    /**
     * @param {Object} options
     * @param {SelectorInput} [options.selector]
     * @param {Selector | (() => HTMLElement)} [options.root]
     * @param {Selector | (() => HTMLElement)} [options.origin]
     */
    constructor({ selector, root, origin }: {
        selector?: SelectorInput;
        root?: Selector | (() => HTMLElement);
        origin?: Selector | (() => HTMLElement);
    });
    root(): any;
    origin(): any;
    traverse(): any;
    query({ strict }?: {
        strict?: boolean;
    }): any;
    queryAll(): any;
    toString(): any;
    #private;
}
export default Selector;
export type SelectorInput = (string | RegExp | HTMLElement | {
    (options: {
        $root?: HTMLElement;
        $origin?: HTMLElement;
    }): HTMLElement | HTMLElement[];
});
