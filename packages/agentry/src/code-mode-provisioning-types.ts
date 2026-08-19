import type {
  EndoConnectionFailureContext,
  EndoConnectionFailureObserver,
  EndoProvisionConnectionOptions,
  EndoProvisionPersistence as DaemonProvisionPersistence,
  EndoProvisionPolicy as DaemonProvisionPolicy,
  EndoProvisionSpec as DaemonProvisionSpec,
  GitGrant,
  GitRemoteSpec,
  MountGrant,
  NormalizedGitGrant,
  NormalizedGitRemoteSpec,
  NormalizedMountGrant,
} from '@endo/daemon/grants.js';
import type { EndoGuest } from '@endo/daemon';

import type {
  CodeModeGlobal,
  CodeModeGrant,
} from '@endo/agent-tools/code-mode/types.js';

export type {
  EndoConnectionFailureContext,
  EndoConnectionFailureObserver,
  GitGrant,
  GitRemoteSpec,
  MountGrant,
  NormalizedGitGrant,
  NormalizedGitRemoteSpec,
  NormalizedMountGrant,
};

export type EndoProvisionGrantSpec = {
  /** Host-side pet-name path resolved when the session is first provisioned. */
  from: string[];
  /** Optional supplemental prompt context, never a method declaration. */
  description?: string;
};

export type EndoProvisionSpec = Omit<DaemonProvisionSpec, 'powers'> & {
  /** Keep Pi's standard tools active alongside the Endo evaluate tool. */
  piTools?: 'preserve';
  /** Named capabilities projected into code-mode grants and prompt globals. */
  grants?: { [name: string]: EndoProvisionGrantSpec };
};

export type EndoProvisionPolicy = Omit<DaemonProvisionPolicy, 'powers'> & {
  piTools?: 'preserve';
  grants?: { [name: string]: EndoProvisionGrantSpec };
};

/**
 * Plain code-mode reconstruction data.
 *
 * Version 3 separates daemon authority policy from code-mode prompt context.
 */
export type EndoProvisionPersistence = Omit<
  DaemonProvisionPersistence,
  'version' | 'policy'
> & {
  version: 3;
  policy: EndoProvisionPolicy;
};

export type EndoProvisionForkOptions = {
  forkFrom?: EndoProvisionPersistence;
};

export type NormalizeEndoProvisionOptions = {
  harness: string;
  sessionId: string;
  cwd: string;
};

export type EndoCodeModeConnectionOptions = EndoProvisionConnectionOptions;

export type ProvisionEndoCodeModeOptions = NormalizeEndoProvisionOptions &
  EndoCodeModeConnectionOptions & {
    spec?: EndoProvisionSpec;
  };

export type ReconstructEndoCodeModeOptions = EndoCodeModeConnectionOptions &
  EndoProvisionForkOptions & {
    persistence: EndoProvisionPersistence;
  };

export type EndoProvisionResult = {
  powers: EndoGuest;
  grants: CodeModeGrant[];
  globals: CodeModeGlobal[];
  persistence: EndoProvisionPersistence;
  cleanup: () => Promise<void>;
};
