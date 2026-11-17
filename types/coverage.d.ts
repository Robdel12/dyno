export interface CoverageSourceMap {
  readonly version: 3;
  readonly sources: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
  readonly sourcesContent?: readonly (string | null)[];
  readonly sourceRoot?: string;
  readonly file?: string;
}

interface CoveragePosition {
  readonly line: number;
  readonly column: number;
}

interface CoverageLocation {
  readonly start: CoveragePosition;
  readonly end: CoveragePosition;
}

export interface CoverageFile {
  readonly path: string;
  readonly hash?: string;
  readonly statementMap: Readonly<Record<string, CoverageLocation>>;
  readonly fnMap: Readonly<Record<string, {
    readonly name: string;
    readonly decl: CoverageLocation;
    readonly loc: CoverageLocation;
    readonly line: number;
  }>>;
  readonly branchMap: Readonly<Record<string, {
    readonly type: string;
    readonly loc: CoverageLocation;
    readonly locations: readonly CoverageLocation[];
    readonly line: number;
  }>>;
  readonly s: Readonly<Record<string, number>>;
  readonly f: Readonly<Record<string, number>>;
  readonly b: Readonly<Record<string, readonly number[]>>;
  readonly bT?: Readonly<Record<string, readonly number[]>>;
  readonly inputSourceMap?: CoverageSourceMap;
}

export interface CoverageInstrumentOptions {
  readonly code: string;
  readonly filename: string;
  readonly inputSourceMap?: CoverageSourceMap | null;
}

export interface CoverageInstrumentResult {
  readonly code: string;
  readonly map: CoverageSourceMap | null;
  readonly coverage: CoverageFile;
}

export function instrumentCoverage(options: CoverageInstrumentOptions): CoverageInstrumentResult;
