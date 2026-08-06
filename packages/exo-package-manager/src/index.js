// @ts-check

export {
  makePackageManager,
  isPackageManagerReadOnly,
} from './package-manager.js';

export {
  MANAGER_NAMES,
  LOCKFILE_MARKERS,
  FROZEN_LOCKFILES,
  parsePackageManagerField,
  managersFromMarkers,
  hasFrozenLockfile,
  selectManager,
} from './detect.js';

export { buildInstallArgv, buildRunArgv } from './argv.js';

export {
  makePackageManagerError,
  getPackageManagerErrorCode,
  getPackageManagerErrorDetails,
} from './errors.js';

export {
  PackageManagerInterface,
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
} from './interfaces.js';
