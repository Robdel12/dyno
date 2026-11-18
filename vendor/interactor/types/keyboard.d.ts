/**
 * @typedef {Keyboard.Events} KeyboardEvents
 */
/**
 * @typedef {(
 *   string & keyof Keyboard.Events
 * )} KeyboardKey
 */
/**
 * @template {KeyboardKey} T
 * @typedef {KeyboardEvents[T]} KeyboardEvent
 */
export class Keyboard {
    /**
     * @param {Keyboard} [previous]
     */
    constructor(previous?: Keyboard);
    state: any[];
    /**
     * @template {KeyboardKey} T
     * @param {T} key
     * @param {boolean} [canonical]
     * @returns {KeyboardEvent<T>}
     */
    get<T extends KeyboardKey>(key: T, canonical?: boolean): KeyboardEvent<T>;
    /**
     * @param {KeyboardKey} key
     * @returns {boolean}
     */
    pressed(key: KeyboardKey): boolean;
    /**
     * @param {KeyboardKey} key
     * @returns {this}
     */
    toggle(key: KeyboardKey): this;
    /**
     * @param {KeyboardKey} key
     * @returns {{
     *   text: string,
     *   event: {
     *     key: KeyboardKey
     *     code: KeyboardKey
     *     keyCode: number
     *     location: number
     *     repeat: boolean
     *     altKey: boolean
     *     ctrlKey: boolean
     *     metaKey: boolean
     *     shiftKey: boolean
     *   }
     * }}
     */
    parse(key: KeyboardKey): {
        text: string;
        event: {
            key: KeyboardKey;
            code: KeyboardKey;
            keyCode: number;
            location: number;
            repeat: boolean;
            altKey: boolean;
            ctrlKey: boolean;
            metaKey: boolean;
            shiftKey: boolean;
        };
    };
}
export namespace Keyboard {
    let Events: any;
}
export default Keyboard;
export type KeyboardEvents = any;
export type KeyboardKey = (string & (string | number | symbol));
export type KeyboardEvent<T extends KeyboardKey> = KeyboardEvents[T];
