import { Interactor as BrowserInteractor } from 'interactor.js';

export interface UploadFile {
  readonly bytes: BlobPart;
  readonly name: string;
  readonly type?: string;
}
type Chain<T> = { readonly then: Interactor & PromiseLike<T>['then'] };
type Assertions = BrowserInteractor['assert'] & {
  rendered(): Chain<boolean>;
  readonly not: BrowserInteractor['assert']['not'] & { rendered(): Chain<boolean> };
};
export class Interactor extends BrowserInteractor {
  scope(selector: Parameters<BrowserInteractor['find']>[0]): Interactor;
  fill(value: string | number): Chain<HTMLElement>;
  upload(...files: UploadFile[]): Chain<HTMLElement>;
  get assert(): Assertions;
  find(selector?: Parameters<BrowserInteractor['find']>[0]): ReturnType<BrowserInteractor['find']> & Assertions & Chain<HTMLElement>;
}

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
