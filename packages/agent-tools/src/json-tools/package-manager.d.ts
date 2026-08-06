import type { ERef } from '@endo/eventual-send';
import type { ToolRecord } from '../types.js';

export type PackageManagerToolCapability = {
  detect: (input?: object) => Promise<object>;
  scripts: (input?: object) => Promise<object>;
  install: (input: object) => Promise<object>;
  run: (input: object) => Promise<object>;
  cancel: (operationId: string) => Promise<boolean>;
  readOnly?: () => PackageManagerToolCapability;
};

export type PackageManagerToolsOptions = {
  mount?: ERef<{ entry: (segments: string[]) => Promise<object> }>;
  includeReadTools?: boolean;
};

export declare const makePackageManagerTools: (
  pmCap: ERef<PackageManagerToolCapability>,
  options?: PackageManagerToolsOptions,
) => ToolRecord[];
