export class Assert {
    static Symbol: symbol;
    /**
     * @overload
     * @param {string} name
     * @param {(
     *   (new (...args: any[]) => Assertion) |
     *   ((...args: any[]) => AssertSubject) |
     *   AssertObject
     * )} assertion
     * @returns {typeof Assert}
     */
    static defineAssertion(name: string, assertion: ((new (...args: any[]) => Assertion) | ((...args: any[]) => boolean | void | import("./context.js").ContextFunction<{}, any>) | {
        assertion: (context: Context<{}>) => any;
        failureMessage?: import("./assertion.js").AssertMessage;
        negatedMessage?: import("./assertion.js").AssertMessage;
    })): typeof Assert;
    /**
     * @overload
     * @param {string} name
     * @param {(...args: any[]) => AssertSubject} assertion
     * @param {AssertMessage} [failureMessage]
     * @param {AssertMessage} [negatedMessage]
     * @returns {typeof Assert}
     */
    static defineAssertion(name: string, assertion: (...args: any[]) => boolean | void | import("./context.js").ContextFunction<{}, any>, failureMessage?: import("./assertion.js").AssertMessage, negatedMessage?: import("./assertion.js").AssertMessage): typeof Assert;
    /**
     * @param {{
     *   [name: string]:
     *     (new (...args: any[]) => Assertion) |
     *     ((...args: any[]) => AssertSubject) |
     *     AssertObject
     * }} assertions
     * @returns {typeof Assert}
     */
    static defineAssertions(assertions: {
        [name: string]: (new (...args: any[]) => Assertion) | ((...args: any[]) => boolean | void | import("./context.js").ContextFunction<{}, any>) | {
            assertion: (context: Context<{}>) => any;
            failureMessage?: import("./assertion.js").AssertMessage;
            negatedMessage?: import("./assertion.js").AssertMessage;
        };
    }): typeof Assert;
    /** @typedef {import('./interactor').Interactor} Interactor */
    /**
     * @template [T = {}]
     * @typedef {import('./context').ContextOptions<T>} ContextOptions
     */
    /**
     * @param {Interactor} i
     * @param {ContextOptions} [context]
     */
    constructor(i: import("./interactor").Interactor, context?: {
        [key: string]: any;
        root?: () => HTMLElement;
        selector?: import("./selector.js").SelectorInput;
        immediate?: /*elided*/ any;
        assert?: {
            expected?: boolean;
            timeout?: number;
            frequency?: number;
            reliability?: number;
        };
    });
    /**
     * @type {(((
     *   assertion: AssertSubject | typeof Assertion,
     *   negatedMessage: AssertMessage
     * ) => import('./chainable').Chainable<Assertion, Interactor, boolean>) & this)}
     */
    get not(): (((assertion: (boolean | void | import("./context.js").ContextFunction<{}, any>) | typeof Assertion, negatedMessage: import("./assertion.js").AssertMessage) => import("./chainable").Chainable<Assertion, import("./interactor").Interactor, boolean>) & this);
    attribute: (name: string, expected: string) => import("./chainable.js").Chainable<typeof import("./assertions/attribute.js").AttributeAssertion, import("./interactor").Interactor, boolean>;
    checked: () => import("./chainable.js").Chainable<typeof import("./assertions/checked.js").CheckedAssertion, import("./interactor").Interactor, boolean>;
    contains: (selector: import("./selector.js").SelectorInput) => import("./chainable.js").Chainable<typeof import("./assertions/contains.js").ContainsAssertion, import("./interactor").Interactor, boolean>;
    disabled: () => import("./chainable.js").Chainable<typeof import("./assertions/disabled.js").DisabledAssertion, import("./interactor").Interactor, boolean>;
    exists: () => import("./chainable.js").Chainable<typeof import("./assertions/exists.js").ExistsAssertion, import("./interactor").Interactor, boolean>;
    focusable: () => import("./chainable.js").Chainable<typeof import("./assertions/focusable.js").FocusableAssertion, import("./interactor").Interactor, boolean>;
    focused: () => import("./chainable.js").Chainable<typeof import("./assertions/focused.js").FocusedAssertion, import("./interactor").Interactor, boolean>;
    matches: (selector: string) => import("./chainable.js").Chainable<typeof import("./assertions/matches.js").MatchesAssertion, import("./interactor").Interactor, boolean>;
    overflows: (axis?: "x" | "y") => import("./chainable.js").Chainable<typeof import("./assertions/overflows.js").OverflowsAssertion, import("./interactor").Interactor, boolean>;
    property: (name: string, expected: any) => import("./chainable.js").Chainable<typeof import("./assertions/property.js").PropertyAssertion, import("./interactor").Interactor, boolean>;
    scrollable: (axis?: "x" | "y") => import("./chainable.js").Chainable<typeof import("./assertions/scrollable.js").ScrollableAssertion, import("./interactor").Interactor, boolean>;
    selected: () => import("./chainable.js").Chainable<typeof import("./assertions/selected.js").SelectedAssertion, import("./interactor").Interactor, boolean>;
    text: (expected: string) => import("./chainable.js").Chainable<typeof import("./assertions/text.js").TextAssertion, import("./interactor").Interactor, boolean>;
    value: (expected: any) => import("./chainable.js").Chainable<typeof import("./assertions/value.js").ValueAssertion, import("./interactor").Interactor, boolean>;
    visible: () => import("./chainable.js").Chainable<typeof import("./assertions/visible.js").VisibleAssertion, import("./interactor").Interactor, boolean>;
    within: (selector: string) => import("./chainable.js").Chainable<typeof import("./assertions/within.js").WithinAssertion, import("./interactor").Interactor, boolean>;
}
export default Assert;
import Assertion from './assertion.js';
import Context from './context.js';
