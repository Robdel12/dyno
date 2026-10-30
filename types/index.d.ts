import { Interactor as BrowserInteractor } from 'interactor.js';

export interface UploadFile {
  readonly bytes: BlobPart;
  readonly name: string;
  readonly type?: string;
}
type Selector = Parameters<BrowserInteractor['find']>[0];
type Actions = Record<string, (...args: any[]) => unknown>;
type AssertionDefinitions = Parameters<typeof BrowserInteractor.defineAssertions>[0];
type Chain<T, I = Interactor> = { readonly then: I & PromiseLike<T>['then'] };
type AssertionArguments<T> = T extends (...args: infer A) => unknown ? A : T extends new (...args: infer A) => unknown ? A : [];
type AssertionMethods<S, I> = { [K in keyof S]: (...args: AssertionArguments<S[K]>) => Chain<boolean, I> };
type Rechain<F, I> = F extends (...args: infer A) => infer R ? (...args: A) => R & Chain<Awaited<R>, I> : F;
type NativeAssertions<I> = {
  [K in Exclude<keyof BrowserInteractor['assert'], 'not'>]: Rechain<BrowserInteractor['assert'][K], I>;
};
type AssertionChecks<S, I> = NativeAssertions<I> & AssertionMethods<S, I> & {
  rendered(): Chain<boolean, I>;
};
type Assertions<S, I> = AssertionChecks<S, I> & {
  readonly not: AssertionChecks<S, I> & BrowserInteractor['assert']['not'];
} & BrowserInteractor['assert'];
type Found<S, I> = Omit<ReturnType<BrowserInteractor['find']>, keyof BrowserInteractor['assert'] | 'then' | 'times'> & AssertionChecks<S, I> & {
  readonly not: AssertionChecks<S, I> & {
    times: Rechain<ReturnType<BrowserInteractor['find']>['times'], I>;
  } & ReturnType<BrowserInteractor['find']>['not'];
  times: Rechain<ReturnType<BrowserInteractor['find']>['times'], I>;
} & Chain<HTMLElement, I>;
export class Interactor<S extends AssertionDefinitions = {}> extends BrowserInteractor {
  scope(selector?: Selector): this;
  fill(value: string | number): Chain<HTMLElement, this>;
  upload(...files: UploadFile[]): Chain<HTMLElement, this>;
  click: (...args: Parameters<BrowserInteractor['click']>) => ReturnType<BrowserInteractor['click']> & Chain<HTMLElement, this>;
  focus: (...args: Parameters<BrowserInteractor['focus']>) => ReturnType<BrowserInteractor['focus']> & Chain<HTMLElement, this>;
  blur: (...args: Parameters<BrowserInteractor['blur']>) => ReturnType<BrowserInteractor['blur']> & Chain<HTMLElement, this>;
  press: (...args: Parameters<BrowserInteractor['press']>) => ReturnType<BrowserInteractor['press']> & Chain<unknown, this>;
  trigger: (...args: Parameters<BrowserInteractor['trigger']>) => ReturnType<BrowserInteractor['trigger']> & Chain<boolean, this>;
  type: (...args: Parameters<BrowserInteractor['type']>) => ReturnType<BrowserInteractor['type']> & Chain<HTMLElement, this>;
  get assert(): Assertions<S, this>;
  find(selector?: Selector): Found<S, this>;
}

type ActionResult<T> = T extends Generator<unknown, infer R, unknown> ? ActionResult<R> : T extends PromiseLike<infer R> ? ActionResult<R> : T extends (...args: any[]) => infer R ? ActionResult<R> : T;
export type CustomInteractor<A extends Actions, S extends AssertionDefinitions> = Interactor<S> & {
  [K in keyof A]: (...args: Parameters<A[K]>) => Chain<ActionResult<ReturnType<A[K]>>, CustomInteractor<A, S>>;
};
export type InteractorContext = InstanceType<typeof BrowserInteractor.Context>;
export function defineInteractor<A extends Actions = {}, S extends AssertionDefinitions = {}>(definition: {
  readonly actions?: A & ThisType<CustomInteractor<A, S>>;
  readonly assertions?: S & ThisType<CustomInteractor<A, S>>;
}): (interactor: Interactor, selector?: Selector) => CustomInteractor<A, S>;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}
export interface BrowserIdentity {
  readonly name: string;
  readonly provider: 'native' | 'playwright' | 'webdriver';
  readonly version?: string;
  readonly build?: string;
}
export interface CapturedScreenshot {
  readonly status: 'captured';
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly viewport: Viewport;
  readonly browser: BrowserIdentity;
  readonly policy: {
    readonly fullPage: boolean;
    readonly animations: 'allow' | 'disabled';
    readonly caret: 'hide' | 'initial';
    readonly scale: 'device';
  };
}
export interface SkippedScreenshot {
  readonly status: 'skipped';
  readonly id: string;
  readonly name: string;
  readonly reason: string;
}
export type Screenshot = CapturedScreenshot | SkippedScreenshot;
export interface ScreenshotOptions {
  readonly optional?: boolean;
  readonly fullPage?: boolean;
  readonly animations?: 'allow' | 'disabled';
  readonly caret?: 'hide' | 'initial';
  readonly mask?: readonly Element[];
}
export interface Application {
  goto(path: string): Promise<void>;
  request(path: string, options?: RequestInit): Promise<Response>;
  setViewport(viewport: Viewport): Promise<Viewport>;
  screenshot(name: string, options?: ScreenshotOptions): Promise<Screenshot>;
  pause(message?: string): Promise<void>;
  readonly document: Document;
  readonly window: Window & typeof globalThis;
}
export interface TestDescriptor {
  readonly id: string;
  readonly file: string;
  readonly suites: readonly string[];
  readonly name: string;
  readonly index: number;
  readonly timeout?: number;
  readonly skipReason: string | null;
}
/** Extend this interface in your project to type setup fixtures. */
export interface Fixtures {
  [name: string]: unknown;
}
export interface TimingEntry {
  readonly id: number;
  readonly kind: 'reset' | 'beforeEach' | 'test' | 'afterEach' | 'drain' | 'navigation' | 'request' | 'screenshot' | 'viewport' | 'pause' | 'step' | 'lifecycle';
  readonly name: string;
  readonly start: number;
  readonly duration: number;
  readonly status: 'running' | 'passed' | 'failed' | 'cancelled';
  readonly phase?: 'reset' | 'beforeEach' | 'test' | 'afterEach' | 'drain';
}
export interface Timings {
  readonly duration: number;
  readonly truncated: number;
  readonly entries: readonly TimingEntry[];
}
export interface TestContext {
  readonly app: Application;
  readonly I: Interactor;
  readonly fixtures: Fixtures;
  readonly signal: AbortSignal;
  readonly test: TestDescriptor;
  readonly step: <T>(name: string, work: () => T | PromiseLike<T>) => Promise<T>;
}
export type TestCallback = (context: TestContext) => void | PromiseLike<unknown>;
export interface TestOptions {
  timeout?: number;
  reason?: string;
}
export interface TestFunction {
  (name: string, run: TestCallback, options?: TestOptions): void;
  only(name: string, run: TestCallback, options?: TestOptions): void;
  skip(name: string, run?: TestCallback, options?: TestOptions): void;
}
export interface DescribeFunction {
  (name: string, define: () => void): void;
  only(name: string, define: () => void): void;
  skip(name: string, define: () => void): void;
}
export let test: TestFunction;
export let describe: DescribeFunction;
export function beforeEach(run: TestCallback): void;
export function afterEach(run: TestCallback): void;
