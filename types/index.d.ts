import type { Interactor as BrowserInteractor } from 'interactor.js';
export { Interactor } from 'interactor.js';

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
}
export interface SkippedScreenshot {
  readonly status: 'skipped';
  readonly id: string;
  readonly name: string;
  readonly reason: string;
}
export type Screenshot = CapturedScreenshot | SkippedScreenshot;
export interface Application {
  goto(path: string): Promise<void>;
  request(path: string, options?: RequestInit): Promise<Response>;
  setViewport(viewport: Viewport): Promise<Viewport>;
  screenshot(name: string, options?: { optional?: boolean }): Promise<Screenshot>;
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
export interface TestContext {
  readonly app: Application;
  readonly I: BrowserInteractor;
  readonly fixtures: Fixtures;
  readonly signal: AbortSignal;
  readonly test: TestDescriptor;
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
