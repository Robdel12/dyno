/** @template [T = any] */
export class Interaction<T = any> {
    static Symbol: symbol;
    /**
     * @param {import('./context').ContextYield} [interaction]
     */
    constructor(interaction?: import("./context").ContextYield);
}
export default Interaction;
