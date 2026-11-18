/**
 * @template {{ assert?: boolean, [key: string]: any }} [T = {}]
 * @typedef {(void | boolean | import('./context').ContextFunction<T>)} AssertSubject
 */
/**
 * @template {{ assert?: boolean, [key: string]: any }} [T = {}]
 * @typedef {import('./context').ContextFunction<T>} AssertFunction
 */
/**
 * @typedef {(string | ((context: Context) => string))} AssertMessage
 */
/**
 * @template {(AssertSubject | AssertFunction)} [T = AssertSubject]
 * @typedef {{ assertion: T, failureMessage?: AssertMessage, negatedMessage?: AssertMessage }} AssertObject
 */
/**
 * @param {(AssertObject | AssertSubject)} assertion
 * @param {AssertMessage} [failureMessage]
 * @param {AssertMessage} [negatedMessage]
 * @returns {import('./context').ContextGenerator<{ assert?: boolean }>}
 */
export function assert(assertion: (AssertObject | AssertSubject), failureMessage?: AssertMessage, negatedMessage?: AssertMessage): import("./context").ContextGenerator<{
    assert?: boolean;
}>;
export class Assertion {
    static Symbol: symbol;
    /**
     * @overload
     * @param {AssertObject} options
     */
    constructor(options: AssertObject);
    /**
     * @overload
     * @param {AssertSubject} assertion
     * @param {AssertMessage} [failureMessage]
     * @param {AssertMessage} [negatedMessage]
     */
    constructor(assertion: AssertSubject, failureMessage?: AssertMessage, negatedMessage?: AssertMessage);
}
export default Assertion;
export type AssertSubject<T extends {
    assert?: boolean;
    [key: string]: any;
} = {}> = (void | boolean | import("./context").ContextFunction<T>);
export type AssertFunction<T extends {
    assert?: boolean;
    [key: string]: any;
} = {}> = import("./context").ContextFunction<T>;
export type AssertMessage = (string | ((context: Context) => string));
export type AssertObject<T extends (AssertSubject | AssertFunction) = AssertSubject<{}>> = {
    assertion: T;
    failureMessage?: AssertMessage;
    negatedMessage?: AssertMessage;
};
import Context from './context.js';
