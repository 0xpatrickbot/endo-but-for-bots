import type { NormalizedRemotePolicy, RemotePolicy } from '@endo/exo-git';

import type { EndoDirectory, EndoGuest, EndoHost } from './types.js';

export type GitRemoteSpec = Omit<
  RemotePolicy,
  'allowedDirections' | 'fetchRefspecs' | 'pushRefspecs'
> & {
  allowedDirections?: Array<'fetch' | 'push'>;
  fetchRefspecs?: string[];
  pushRefspecs?: string[];
  /** Host-side pet name only. */
  /** Secret material is never accepted here. */
  credential?: string | string[];
};

export type MountGrant = {
  /** Relative to the provisioning cwd, or an explicitly selected absolute root. */
  path: string;
  mode: 'readOnly' | 'readWrite';
  deniedSegments?: string[];
};

export type GitGrant = {
  /** Defaults to the compatibility `workspace` mount. */
  mount?: string;
  /** Mount-relative path segments naming a non-bare Git worktree. */
  path: string[];
  mode: 'readOnly' | 'readWrite' | 'historyRewrite';
};

export type NormalizedMountGrant = {
  /** Canonical absolute root, retained only in trusted policy state. */
  root: string;
  mode: 'readOnly' | 'readWrite';
  deniedSegments: string[];
  /** Whether this explicitly granted mount is bound into the guest. */
  guestBinding: boolean;
};

export type NormalizedGitGrant = {
  /** Explicit selected mount name. */
  mount: string;
  /** Mount-relative selector segments. */
  path: string[];
  /** Canonical absolute worktree root, retained only in trusted policy state. */
  root: string;
  mode: 'readOnly' | 'readWrite' | 'historyRewrite';
};

export type EndoProvisionPowerSpec = {
  /** Host-side pet-name path resolved when the session is first provisioned. */
  from: string[];
};

export type EndoProvisionSpec = {
  workspace?: {
    path?: string;
    deniedSegments?: string[];
  };
  fs?: 'readOnly' | 'readWrite';
  git?: 'readOnly' | 'readWrite' | 'historyRewrite';
  mounts?: { [name: string]: MountGrant };
  gits?: { [name: string]: GitGrant };
  gitRemotes?: { [name: string]: GitRemoteSpec };
  /** Named host capabilities to introduce into the retained guest. */
  powers?: { [name: string]: EndoProvisionPowerSpec };
};

export type NormalizedGitRemoteSpec = NormalizedRemotePolicy & {
  credential?: string | string[];
};

export type EndoProvisionPolicy = {
  /** One authority graph for all filesystem roots. */
  mounts: { [name: string]: NormalizedMountGrant };
  /** Every Git grant names its selected mount explicitly. */
  gits?: { [name: string]: NormalizedGitGrant };
  gitRemotes?: { [name: string]: NormalizedGitRemoteSpec };
  /** Named host capabilities retained and introduced into the guest. */
  powers?: { [name: string]: EndoProvisionPowerSpec };
};

/**
 * Plain, non-secret reconstruction data.
 *
 * The record deliberately excludes formula identifiers, live capabilities,
 * credential material, daemon endpoints, and host authority.
 */
export type EndoProvisionPersistence = {
  version: 1;
  guestHandlePath: string[];
  workspacePath: string;
  policy: EndoProvisionPolicy;
};

/**
 * Optional parent retained session used while creating a forked guest.
 * The host validates this inert record and copies formula identifiers from its
 * retained controller aliases; it never gives the guest host lookup access.
 */
export type EndoProvisionForkOptions = {
  forkFrom?: EndoProvisionPersistence;
};

export type NormalizeEndoProvisionOptions = {
  /** Pet-name key that scopes retained daemon state for this consumer. */
  scope: string;
  /** Stable caller-owned identifier used only to derive deterministic names. */
  sessionId: string;
  /** Caller-supplied working directory used to resolve a relative workspace. */
  cwd: string;
};

/** Narrow host-owned observation of a failed daemon connection. */
export type EndoConnectionFailureContext = {
  kind: 'disconnect' | 'protocol';
};

export type EndoConnectionFailureObserver = (
  error: unknown,
  context: EndoConnectionFailureContext,
) => void;

export type EndoProvisionConnectionOptions = {
  /** Optional daemon socket override, independent of the workspace path. */
  sockPath?: string;
  /**
   * Observe connection failures that are not owned by an operation promise.
   * Application rejections remain exclusively deliverable through their
   * original promises.
   */
  onConnectionFailure?: EndoConnectionFailureObserver;
};

export type ProvisionEndoGuestOptions = NormalizeEndoProvisionOptions &
  EndoProvisionConnectionOptions & {
    spec?: EndoProvisionSpec;
  };

export type ReconstructEndoGuestOptions = EndoProvisionConnectionOptions &
  EndoProvisionForkOptions & {
    persistence: EndoProvisionPersistence;
  };

export type EndoProvisionResult = {
  /** Retained guest holding the filesystem, Git, and named powers. */
  guest: EndoGuest;
  persistence: EndoProvisionPersistence;
  /** Close client-side CapTP and cancel this caller's local operations. */
  cleanup: () => Promise<void>;
};

/**
 * Filesystem and path operations that parameterize the shared provisioning
 * policy.
 * The client wires these from `node:fs/promises` and `node:path`;
 * the daemon injects its supervisor's file powers so the host-side core
 * stays free of `node:` imports.
 */
export type ProvisionPathPowers = {
  /** Resolve symlinks to a canonical path; throws when unresolvable. */
  realPath: (path: string) => Promise<string>;
  /** Whether the path names an existing directory; false on any failure. */
  isDirectory: (path: string) => Promise<boolean>;
  resolvePath: (...segments: string[]) => string;
  relativePath: (from: string, to: string) => string;
  isAbsolutePath: (path: string) => boolean;
  pathSeparator: string;
};

/**
 * The host-local functions a daemon host lends to `makeHostProvision`.
 * All calls are direct, in-process invocations; realization performs no
 * CapTP round trips.
 */
export type HostProvisionPowers = {
  /** Absent when the supervisor does not wire path powers; fails closed. */
  pathPowers: ProvisionPathPowers | undefined;
  has: (...petNamePath: string[]) => Promise<boolean>;
  identify: (...petNamePath: string[]) => Promise<string | undefined>;
  lookup: (petNamePath: string | string[]) => Promise<unknown>;
  lookupById: EndoHost['lookupById'];
  makeDirectory: (petNamePath: string | string[]) => Promise<EndoDirectory>;
  storeValue: EndoHost['storeValue'];
  storeIdentifier: (
    petNamePath: string | string[],
    id: string,
  ) => Promise<void>;
  provideMount: EndoHost['provideMount'];
  provideGit: EndoHost['provideGit'];
  provideGitRemote: EndoHost['provideGitRemote'];
  provideGuest: EndoHost['provideGuest'];
  getGitCredentialController: EndoHost['getGitCredentialController'];
  getGitRemoteController: EndoHost['getGitRemoteController'];
};
