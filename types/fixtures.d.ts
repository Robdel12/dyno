import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExecutionPreparation, ProjectExecution } from './config.js';

export type JsonValue = null | boolean | string | number | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface FixtureIdentity {
  readonly runId: string;
  readonly workerId: string;
  readonly executionId: string;
}
export interface FixtureScope extends FixtureIdentity {
  readonly token: string;
}
export interface FixtureExecution extends FixtureIdentity {
  readonly signal: AbortSignal;
}
export interface FixtureHold {
  idle(options?: { readonly signal?: AbortSignal }): void | PromiseLike<void>;
  resume(): void;
}
export type FixtureOperation<Context> = (context: Context, input: JsonValue, execution: FixtureExecution) => JsonValue | PromiseLike<JsonValue>;
type Definitions = Readonly<Record<string, (...args: any[]) => unknown>>;
type Intersect<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;
export function defineFixtureOperations<Maps extends readonly Definitions[]>(...maps: Maps): Readonly<Intersect<Maps[number]>>;
export interface FixtureController {
  begin(identity: FixtureIdentity, options?: { readonly signal?: AbortSignal }): Promise<{
    readonly fixtures: Readonly<Record<string, JsonValue>>;
    readonly scope: FixtureScope;
  }>;
  dispatch(input: { readonly scope: FixtureScope; readonly name: string; readonly input: JsonValue }, options?: { readonly signal?: AbortSignal }): Promise<JsonValue>;
  drain(identity: FixtureIdentity, options?: { readonly signal?: AbortSignal }): Promise<void>;
  close(options?: { readonly signal?: AbortSignal }): Promise<void>;
}
export function createFixtureController<Context>(options: {
  readonly workerId: string;
  readonly context: Context;
  readonly operations?: Readonly<Record<string, FixtureOperation<Context>>>;
  readonly pause?: () => FixtureHold;
  readonly reset?: (context: Context, execution: FixtureExecution) => void | Readonly<Record<string, JsonValue>> | PromiseLike<void | Readonly<Record<string, JsonValue>>>;
  readonly drain?: (context: Context, execution: FixtureExecution) => void | PromiseLike<void>;
}): FixtureController;
export function createFixtureHttpHandler(controller: FixtureController, options: {
  readonly token: string;
  readonly path?: string;
}): (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
export function connectFixtureControl(options: {
  readonly url: string;
  readonly workerId: string;
  readonly token: string;
  readonly path?: string;
}): {
  begin(context: ProjectExecution): Promise<ExecutionPreparation>;
  drain(context: ProjectExecution): Promise<void>;
};
