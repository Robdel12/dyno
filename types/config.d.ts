export interface Viewport {
  readonly width: number;
  readonly height: number;
}
export interface Config {
  testDir?: string;
  testMatch?: string;
  timeout?: number;
  cleanupTimeout?: number;
  runTimeout?: number;
  expectTimeout?: number;
  forbidOnly?: boolean;
  port?: number;
  host?: string;
  viewport?: Viewport;
  artifactsDir?: string;
  setup?: string;
  browser?: {
    name?: 'chrome' | 'chromium' | 'edge' | 'firefox' | 'safari' | 'webkit';
    provider?: 'native' | 'playwright' | 'webdriver';
    path?: string;
    args?: readonly string[];
    deviceScaleFactor?: 1 | 2 | 3;
  };
  webServer: {
    url: string;
    command?: string | readonly string[];
    cwd?: string;
    env?: Readonly<Record<string, string>>;
    ready?: string | RegExp;
    timeout?: number;
    reuseExistingServer?: boolean;
  };
}
export function defineConfig(config: Config): Config;
