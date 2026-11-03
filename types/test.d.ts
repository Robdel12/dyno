export interface TestDescriptor {
  readonly resources: readonly string[];
  readonly id: string;
  readonly file: string;
  readonly suites: readonly string[];
  readonly name: string;
  readonly index: number;
  readonly timeout?: number;
  readonly skipReason: string | null;
}
