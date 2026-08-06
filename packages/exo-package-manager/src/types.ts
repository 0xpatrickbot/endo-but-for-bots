/**
 * Public and backend type surface for `@endo/exo-package-manager`.
 *
 * @module
 */

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn';
export type PackageManagerChoice = 'auto' | PackageManagerName;
export type LockfileMode = 'frozen' | 'update';
export type LifecycleScriptsMode = 'disabled' | 'enabled';
export type PackageOperation = 'install' | 'run';
export type PackageTermination =
  | 'exit'
  | 'timeout'
  | 'cancelled'
  | 'output-limit';

export type PackageManagerErrorCode =
  | 'manager-undetected'
  | 'manager-ambiguous'
  | 'manager-mismatch'
  | 'lockfile-missing'
  | 'manager-unavailable'
  | 'workspace-invalid'
  | 'script-not-declared'
  | 'policy-denied'
  | 'sandbox-unavailable'
  | 'read-only';

/**
 * Inert path selector accepted by public methods (platform PathEntry or
 * EndoMountEntry). The portable package never accepts host path strings.
 */
export type PathEntry = {
  segments: () => string[] | Promise<string[]>;
};

export type PackageWorkspaceInput = {
  cwd?: PathEntry;
  manager?: PackageManagerChoice;
};

export type PackageInstallInput = PackageWorkspaceInput & {
  operationId?: string;
  lockfileMode?: LockfileMode;
  offline?: boolean;
  lifecycleScripts?: LifecycleScriptsMode;
  production?: boolean;
  timeoutMs?: number;
};

export type PackageScriptRunInput = PackageWorkspaceInput & {
  operationId?: string;
  script: string;
  args?: string[];
  timeoutMs?: number;
};

export type PackageCommandResult = {
  ok: boolean;
  operation: PackageOperation;
  manager: PackageManagerName;
  managerVersion?: string;
  target: { displayPath: string; workspaceName?: string };
  command: {
    operation: PackageOperation;
    manager: PackageManagerName;
    args: string[];
    redacted: boolean;
  };
  exitCode: number | null;
  signal: string | null;
  termination: PackageTermination;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: { stdout: boolean; stderr: boolean };
  changed: {
    packageJson: boolean;
    lockfile: boolean;
    dependencyTree: boolean;
  };
};

export type PackageManagerDetection = {
  manager: PackageManagerName;
  source: 'explicit' | 'manifest' | 'lockfile' | 'default';
  markerManagers: PackageManagerName[];
  markersPresent: string[];
  displayPath: string;
  versionRequest?: string;
  workspaceName?: string;
  hasFrozenLockfile?: boolean;
};

export type PackageScripts = {
  scriptNames: string[];
  displayPath: string;
  manager: PackageManagerName;
  workspaceName?: string;
};

export type PackageManagerPolicy = {
  allowedManagers?: readonly PackageManagerName[];
  defaultManager?: PackageManagerName;
  allowLockfileUpdate?: boolean;
  allowLifecycleScripts?: boolean;
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  allowCorepack?: boolean;
};

/**
 * Snapshot returned by the backend for pure selection / script listing.
 * Markers are filenames present at the effective project root.
 */
export type WorkspaceSnapshot = {
  packageManagerField?: string;
  markers: Record<string, boolean> | string[];
  scriptNames?: string[];
  workspaceName?: string;
  yarnMajorVersion?: number;
  displayPath?: string;
};

export type InspectWorkspaceInput = {
  segments: string[];
  displayPath: string;
};

export type InstallBackendInput = {
  manager: PackageManagerName;
  versionRequest?: string;
  segments: string[];
  displayPath: string;
  workspaceName?: string;
  yarnMajorVersion?: number;
  lockfileMode: LockfileMode;
  offline: boolean;
  lifecycleScripts: LifecycleScriptsMode;
  production: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  operationId?: string;
};

export type RunBackendInput = {
  manager: PackageManagerName;
  versionRequest?: string;
  segments: string[];
  displayPath: string;
  workspaceName?: string;
  yarnMajorVersion?: number;
  script: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  operationId?: string;
};

/**
 * Backend protocol injected into `makePackageManager`. Concrete backends
 * (sandbox-backed Node, fakes) implement this contract.
 */
export type PackageManagerBackend = {
  inspectWorkspace: (
    input: InspectWorkspaceInput,
  ) => Promise<WorkspaceSnapshot>;
  install: (input: InstallBackendInput) => Promise<PackageCommandResult>;
  run: (input: RunBackendInput) => Promise<PackageCommandResult>;
  cancel: (operationId: string) => Promise<boolean>;
};

export type EndoPackageManager = {
  help: (method?: string) => string;
  detect: (input?: PackageWorkspaceInput) => Promise<PackageManagerDetection>;
  scripts: (input?: PackageWorkspaceInput) => Promise<PackageScripts>;
  install: (input: PackageInstallInput) => Promise<PackageCommandResult>;
  run: (input: PackageScriptRunInput) => Promise<PackageCommandResult>;
  cancel: (operationId: string) => Promise<boolean>;
  readOnly: () => EndoPackageManager;
};
