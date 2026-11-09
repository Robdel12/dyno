export interface Viewport {
  readonly width: number;
  readonly height: number;
}
export interface Config {
  readonly testDir?: string;
  readonly seed?: string;
  readonly random?: boolean;
  readonly workers?: number;
  readonly testMatch?: string;
  readonly timeout?: number;
  readonly cleanupTimeout?: number;
  readonly runTimeout?: number;
  readonly expectTimeout?: number;
  readonly forbidOnly?: boolean;
  readonly port?: number;
  readonly host?: string;
  readonly viewport?: Viewport;
  readonly artifactsDir?: string;
  readonly reportDir?: string;
  readonly setup?: string;
  readonly browser?: {
    readonly name?: 'chrome' | 'chromium' | 'edge' | 'firefox' | 'webkit';
    readonly path?: string;
    readonly args?: readonly string[];
    readonly deviceScaleFactor?: 1 | 2 | 3;
    readonly locale?: string;
    readonly timezoneId?: string;
  };
  readonly webServer: {
    readonly url: string;
    readonly command?: string | readonly string[];
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly ready?: string | RegExp;
    readonly timeout?: number;
    readonly reuseExistingServer?: boolean;
  };
}
export function defineConfig(config: Config): Config;

export interface ProjectContext {
  readonly config: Readonly<Config>;
  readonly signal: AbortSignal;
  readonly session: { readonly id: string };
  readonly onCleanup: (cleanup: () => unknown) => void;
}
export interface ProjectWorkerContext extends ProjectContext {
  readonly worker: { readonly id: string; readonly index: number };
}
export interface ProjectExecution {
  readonly runId: string;
  readonly executionId: string;
  readonly workerId: string;
  readonly test: import('./test.js').TestDescriptor;
  readonly signal: AbortSignal;
}
export interface FixtureTransport {
  readonly path: string;
  readonly scope: {
    readonly runId: string;
    readonly executionId: string;
    readonly workerId: string;
    readonly token: string;
  };
}
export interface ExecutionPreparation {
  readonly fixtures?: Readonly<Record<string, unknown>>;
  readonly fixtureTransport?: FixtureTransport;
}
export interface ProjectWorker {
  readonly webServer?: Partial<Config['webServer']>;
  readonly env?: Readonly<Record<string, string>>;
  readonly fixtures?: Readonly<Record<string, unknown>>;
  readonly beforeExecution?: (context: ProjectExecution) => void | ExecutionPreparation | PromiseLike<void | ExecutionPreparation>;
  readonly drain?: (context: ProjectExecution) => void | PromiseLike<void>;
  readonly teardown?: () => void | PromiseLike<void>;
}
export interface ProjectSetup extends ProjectWorker {
  readonly createWorker?: (context: ProjectWorkerContext) => ProjectWorker | PromiseLike<ProjectWorker>;
}
