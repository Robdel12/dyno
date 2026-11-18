export function flattenChain(chain: any): any;
/**
 * @template T, TChain, TReturn
 * @typedef {(T & {
 *   then: TChain & PromiseLike<
 *     TReturn extends import('./context').ContextGenerator<any, infer R> ? R : TReturn
 *   >["then"]
 * })} Chainable
 */
export function chainable(value: any, instance: any, handler: any): any;
export const Chain: unique symbol;
export default chainable;
export type Chainable<T, TChain, TReturn> = (T & {
    then: TChain & PromiseLike<TReturn extends import("./context").ContextGenerator<any, infer R> ? R : TReturn>["then"];
});
