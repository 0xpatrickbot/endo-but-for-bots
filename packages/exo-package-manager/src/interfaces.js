// @ts-check

import { M } from '@endo/patterns';

// #region Shape primitives

const ManagerNameShape = M.or('npm', 'pnpm', 'yarn');
const ManagerChoiceShape = M.or('auto', ManagerNameShape);
const LockfileModeShape = M.or('frozen', 'update');
const LifecycleScriptsShape = M.or('disabled', 'enabled');
const TerminationShape = M.or('exit', 'timeout', 'cancelled', 'output-limit');
const OperationShape = M.or('install', 'run');

const PathEntryShape = M.remotable('EndoMountEntry');

const PackageWorkspaceInputShape = M.splitRecord(
  {},
  {
    cwd: PathEntryShape,
    manager: ManagerChoiceShape,
  },
);
harden(PackageWorkspaceInputShape);

const PackageInstallInputShape = M.splitRecord(
  {},
  {
    cwd: PathEntryShape,
    manager: ManagerChoiceShape,
    operationId: M.string(),
    lockfileMode: LockfileModeShape,
    offline: M.boolean(),
    lifecycleScripts: LifecycleScriptsShape,
    production: M.boolean(),
    timeoutMs: M.number(),
  },
);
harden(PackageInstallInputShape);

const PackageScriptRunInputShape = M.splitRecord(
  {
    script: M.string(),
  },
  {
    cwd: PathEntryShape,
    manager: ManagerChoiceShape,
    operationId: M.string(),
    args: M.arrayOf(M.string()),
    timeoutMs: M.number(),
  },
);
harden(PackageScriptRunInputShape);

const PackageCommandResultShape = M.splitRecord(
  {
    ok: M.boolean(),
    operation: OperationShape,
    manager: ManagerNameShape,
    target: M.splitRecord(
      { displayPath: M.string() },
      { workspaceName: M.string() },
    ),
    command: M.splitRecord({
      operation: OperationShape,
      manager: ManagerNameShape,
      args: M.arrayOf(M.string()),
      redacted: M.boolean(),
    }),
    exitCode: M.or(M.number(), M.null()),
    signal: M.or(M.string(), M.null()),
    termination: TerminationShape,
    durationMs: M.number(),
    stdout: M.string(),
    stderr: M.string(),
    truncated: M.splitRecord({
      stdout: M.boolean(),
      stderr: M.boolean(),
    }),
    changed: M.splitRecord({
      packageJson: M.boolean(),
      lockfile: M.boolean(),
      dependencyTree: M.boolean(),
    }),
  },
  {
    managerVersion: M.string(),
  },
);
harden(PackageCommandResultShape);

const PackageManagerDetectionShape = M.splitRecord(
  {
    manager: ManagerNameShape,
    source: M.or('explicit', 'manifest', 'lockfile', 'default'),
    markerManagers: M.arrayOf(ManagerNameShape),
    markersPresent: M.arrayOf(M.string()),
    displayPath: M.string(),
  },
  {
    versionRequest: M.string(),
    workspaceName: M.string(),
    hasFrozenLockfile: M.boolean(),
  },
);
harden(PackageManagerDetectionShape);

const PackageScriptsShape = M.splitRecord(
  {
    scriptNames: M.arrayOf(M.string()),
    displayPath: M.string(),
    manager: ManagerNameShape,
  },
  {
    workspaceName: M.string(),
  },
);
harden(PackageScriptsShape);

// #endregion

/**
 * Guarded public `EndoPackageManager` surface.
 *
 * Methods whose resolved values need a return guard use `callWhen`.
 */
export const PackageManagerInterface = M.interface('PackageManager', {
  help: M.call()
    .optional(M.string())
    .returns(M.string()),
  detect: M.callWhen()
    .optional(PackageWorkspaceInputShape)
    .returns(PackageManagerDetectionShape),
  scripts: M.callWhen()
    .optional(PackageWorkspaceInputShape)
    .returns(PackageScriptsShape),
  install: M.callWhen(PackageInstallInputShape).returns(
    PackageCommandResultShape,
  ),
  run: M.callWhen(PackageScriptRunInputShape).returns(PackageCommandResultShape),
  cancel: M.callWhen(M.string()).returns(M.boolean()),
  readOnly: M.call().returns(M.remotable('PackageManager')),
});
harden(PackageManagerInterface);

export {
  ManagerNameShape,
  ManagerChoiceShape,
  LockfileModeShape,
  LifecycleScriptsShape,
  PackageWorkspaceInputShape,
  PackageInstallInputShape,
  PackageScriptRunInputShape,
  PackageCommandResultShape,
  PackageManagerDetectionShape,
  PackageScriptsShape,
};
