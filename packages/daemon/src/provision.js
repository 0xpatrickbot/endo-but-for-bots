// @ts-check
/// <reference types="ses"/>

/**
 * Shared core of daemon guest provisioning: `@endo/patterns` shapes for the
 * inert provisioning spec and its normalized persistence record, the
 * path-parameterized policy normalizer, and the host-side realizer.
 *
 * This module is deliberately free of `node:` imports so `host.js` can use it
 * on the XS daemon bundle.
 * Filesystem and path operations arrive through
 * an injected {@link ProvisionPathPowers} bag: the client wires `node:fs` /
 * `node:path`, the daemon wires its supervisor's file powers.
 */

/** @import { GitRemote, GitRemoteController } from '@endo/exo-git' */
/** @import { EndoProvisionForkOptions, EndoProvisionPersistence, EndoProvisionPolicy, EndoProvisionPowerSpec, EndoProvisionSpec, GitGrant, HostProvisionPowers, MountGrant, NormalizedGitGrant, NormalizedGitRemoteSpec, NormalizedMountGrant, ProvisionPathPowers } from './provision-types.js' */
/** @import { EndoGuest, EndoMount } from './types.js' */

/** @typedef {{ audience(): Promise<string> }} GitCredential */
/** @typedef {{ inspect(): Promise<{ available: boolean, revoked?: boolean }> }} GitCredentialController */

import { makeError, q, X } from '@endo/errors';
import { E } from '@endo/eventual-send';
import { normalizeGitRemotePolicy } from '@endo/exo-git';
import { keyEQ, M, mustMatch } from '@endo/patterns';

import { defaultDeniedSegments } from './mount.js';
import { isPetName } from './pet-name.js';

// Names the host reserves for infrastructure siblings under the controller
// path: the persistence record, the guest handle and agent, and the namespace
// container for provisioned Git remotes.
// A guest-binding name matching one of these is rejected.
// Any residual collision fails closed rather than substituting a trusted
// record for the requested capability.
const HOST_RESERVED_BINDINGS = harden([
  'persistence',
  'guest-agent',
  'guest-handle',
  'remotes',
]);
const SECRET_NAME_RE = /(?:api.?key|authorization|password|secret|token)/iu;
const SCOPE_KEY_RE = /^[a-z][a-z0-9-]{0,31}$/u;
const SESSION_KEY_RE = /^session-[0-9a-f]{64}$/u;

/**
 * Stable message fragment identifying a credential-unavailable failure.
 * The client re-brands CapTP-marshalled rejections carrying this sentinel
 * back into `EndoCredentialUnavailableError`, since class identity does not
 * survive marshalling.
 */
export const CREDENTIAL_UNAVAILABLE_SENTINEL =
  'is unavailable; reprovision the credential on the host and retry';
harden(CREDENTIAL_UNAVAILABLE_SENTINEL);

/**
 * An actionable reconstruction failure for a durable credential whose
 * process-local material did not survive a daemon restart.
 */
export class EndoCredentialUnavailableError extends Error {
  /**
   * @param {string} remoteName
   * @param {string | string[]} credentialPetName
   */
  constructor(remoteName, credentialPetName) {
    super(
      `Git credential ${JSON.stringify(credentialPetName)} for remote ${JSON.stringify(remoteName)} ${CREDENTIAL_UNAVAILABLE_SENTINEL}`,
    );
    this.name = 'EndoCredentialUnavailableError';
    this.code = 'ENDO_CREDENTIAL_UNAVAILABLE';
    this.remoteName = remoteName;
    this.credentialPetName = credentialPetName;
  }
}
harden(EndoCredentialUnavailableError);

// #region Shapes
//
// `M.splitRecord(required, optional, {})` — the explicit `{}` rest closes
// the record; with rest omitted, unknown fields would silently pass.

const FsModeShape = M.or('readOnly', 'readWrite');
const GitModeShape = M.or('readOnly', 'readWrite', 'historyRewrite');
const StringListShape = M.arrayOf(M.string());
const NonEmptyStringListShape = M.splitArray(
  [M.string()],
  undefined,
  StringListShape,
);
const CredentialNameShape = M.or(M.string(), NonEmptyStringListShape);

const MountGrantShape = M.splitRecord(
  { path: M.string(), mode: FsModeShape },
  { deniedSegments: StringListShape },
  {},
);
const WorkspaceGrantShape = M.splitRecord(
  { mode: FsModeShape },
  { path: M.string(), deniedSegments: StringListShape },
  {},
);
const GitGrantShape = M.splitRecord(
  { path: StringListShape, mode: GitModeShape },
  { mount: M.string() },
  {},
);
const GitRemoteSpecShape = M.splitRecord(
  { url: M.string() },
  {
    allowedDirections: M.arrayOf(M.or('fetch', 'push')),
    fetchRefspecs: StringListShape,
    pushRefspecs: StringListShape,
    defaultPullRef: M.string(),
    allowedBranches: StringListShape,
    allowForcePush: M.boolean(),
    allowTags: M.boolean(),
    allowDelete: M.boolean(),
    allowLocalFileTransport: M.boolean(),
    credential: CredentialNameShape,
  },
  {},
);
const PowerSpecShape = M.splitRecord({ from: NonEmptyStringListShape }, {}, {});

export const EndoProvisionSpecShape = M.splitRecord(
  {},
  {
    workspace: WorkspaceGrantShape,
    git: GitModeShape,
    mounts: M.recordOf(M.string(), MountGrantShape),
    gits: M.recordOf(M.string(), GitGrantShape),
    gitRemotes: M.recordOf(M.string(), GitRemoteSpecShape),
    powers: M.recordOf(M.string(), PowerSpecShape),
  },
  {},
);

const NormalizedMountGrantShape = M.splitRecord(
  {
    root: M.string(),
    mode: FsModeShape,
    deniedSegments: StringListShape,
    guestBinding: M.boolean(),
  },
  {},
  {},
);
const NormalizedGitGrantShape = M.splitRecord(
  {
    mount: M.string(),
    path: StringListShape,
    root: M.string(),
    mode: GitModeShape,
  },
  {},
  {},
);
// Persisted remotes are only structurally record-shaped here: validation
// re-normalizes them through the closed `GitRemoteSpecShape` and
// `normalizeGitRemotePolicy`, and the fixpoint check rejects any drift.
const EndoProvisionPolicyShape = M.splitRecord(
  { mounts: M.recordOf(M.string(), NormalizedMountGrantShape) },
  {
    gits: M.recordOf(M.string(), NormalizedGitGrantShape),
    gitRemotes: M.recordOf(M.string(), M.record()),
    powers: M.recordOf(M.string(), PowerSpecShape),
  },
  {},
);

export const EndoProvisionPersistenceShape = M.splitRecord(
  {
    version: 1,
    guestHandlePath: StringListShape,
    workspacePath: M.string(),
    policy: EndoProvisionPolicyShape,
  },
  {},
  {},
);

export const EndoProvisionForkOptionsShape = M.splitRecord(
  {},
  { forkFrom: EndoProvisionPersistenceShape },
  {},
);

// #endregion

// #region Boundary normalization and small assertions

/**
 * Rebuild caller input as hardened, plain-prototype copy-data so `mustMatch`
 * and `keyEQ` accept it.
 * Null-prototype dictionaries, which pass-style rejects, become ordinary
 * records.
 * Own `__proto__` keys are copied as inert data properties.
 * `Object.fromEntries` defines own properties, so no prototype pollution
 * occurs.
 * Exotic values pass through and fail closed at the shape.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
const asCopyData = value => {
  if (Array.isArray(value)) {
    return harden(value.map(asCopyData));
  }
  if (typeof value === 'object' && value !== null) {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return harden(
        Object.fromEntries(
          Object.entries(value).map(([name, child]) => [
            name,
            asCopyData(child),
          ]),
        ),
      );
    }
  }
  return harden(value);
};

/**
 * The daemon polices only its own namespace: a binding name must be a valid
 * pet name and must not shadow a host-reserved infrastructure sibling.
 * Language-identifier and product-binding rules belong to the layer that
 * binds names into a compartment (agentry), not here.
 *
 * @param {string} name
 * @param {string} label
 */
const assertProvisionBindingName = (name, label) => {
  if (!isPetName(name) || HOST_RESERVED_BINDINGS.includes(name)) {
    throw makeError(X`${q(label)} must be a non-reserved pet name`);
  }
};

/** @param {string} scope */
export const assertProvisionScope = scope => {
  if (!SCOPE_KEY_RE.test(scope)) {
    throw makeError(X`scope must match /^[a-z][a-z0-9-]{0,31}$/`);
  }
};
harden(assertProvisionScope);

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
const assertPathString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw makeError(X`${q(label)} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw makeError(X`${q(label)} must not contain NUL bytes`);
  }
  return value;
};

/**
 * Reject obvious credential material before generic shape mismatch
 * reporting, so a caller who supplies a credential object in place of a
 * host-side pet name gets an actionable error.
 *
 * @param {unknown} value
 * @param {string} path
 */
const assertNoSecretFields = (value, path) => {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertNoSecretFields(child, `${path}[${index}]`),
    );
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_NAME_RE.test(key)) {
      throw makeError(
        X`${q(`${path}.${key}`)} looks like credential material; use a host-side credential pet name instead`,
      );
    }
    assertNoSecretFields(child, `${path}.${key}`);
  }
};

/**
 * @param {string[] | undefined} value
 * @param {string} label
 * @returns {string[]}
 */
const normalizeDeniedSegments = (value, label) =>
  harden(
    [
      ...new Set(
        (value ?? defaultDeniedSegments).map((segment, index) => {
          if (
            segment === '.' ||
            segment === '..' ||
            segment.includes('/') ||
            segment.includes('\\')
          ) {
            throw makeError(
              X`${q(`${label}[${index}]`)} must be one path segment`,
            );
          }
          return segment.toLowerCase();
        }),
      ),
    ].sort(),
  );

/**
 * @param {string | string[]} value
 * @param {string} label
 * @returns {string | string[]}
 */
const normalizeCredentialPetNamePath = (value, label) => {
  const segments = typeof value === 'string' ? [value] : value;
  if (segments.length === 0 || !segments.every(isPetName)) {
    throw makeError(X`${q(label)} must be a valid host-side pet name or path`);
  }
  return typeof value === 'string' ? segments[0] : harden([...segments]);
};

/**
 * Await every job, then surface the first failure in declaration order so
 * diagnostics stay deterministic even though the jobs run concurrently.
 *
 * @template T
 * @param {Array<Promise<T>>} jobs
 * @returns {Promise<T[]>}
 */
const allInOrder = async jobs => {
  const outcomes = await Promise.allSettled(jobs);
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      throw outcome.reason;
    }
  }
  return outcomes.map(
    outcome => /** @type {PromiseFulfilledResult<T>} */ (outcome).value,
  );
};

// #endregion

/**
 * Project persistence into the part that selects runtime capability
 * authority.
 *
 * @param {EndoProvisionPersistence} persistence
 * @returns {{ workspacePath: string, policy: EndoProvisionPolicy }}
 */
const projectRuntimeAuthority = persistence => {
  const { policy } = persistence;
  const gits =
    policy.gits === undefined
      ? undefined
      : harden(
          Object.fromEntries(
            Object.entries(policy.gits).map(([name, grant]) => [
              name,
              harden({ ...grant, path: [] }),
            ]),
          ),
        );
  return harden({
    workspacePath: persistence.workspacePath,
    policy: harden({
      ...policy,
      ...(gits === undefined ? {} : { gits }),
    }),
  });
};

/**
 * Make the shared provisioning policy: one `normalizePolicy` implementation
 * serves both the client (real `node:path` / `node:fs`) and the host
 * (injected supervisor file powers), so normalization and host-side
 * revalidation cannot drift.
 *
 * @param {ProvisionPathPowers} pathPowers
 */
export const makeProvisionPolicy = pathPowers => {
  const {
    realPath,
    isDirectory,
    resolvePath,
    relativePath,
    isAbsolutePath,
    pathSeparator,
  } = pathPowers;

  /**
   * @param {string} candidate
   * @param {string} label
   * @returns {Promise<string>}
   */
  const canonicalDirectory = async (candidate, label) => {
    await null;
    let canonical;
    try {
      canonical = await realPath(candidate);
    } catch {
      throw makeError(X`${q(label)} does not exist or cannot be resolved`);
    }
    if (!(await isDirectory(canonical))) {
      throw makeError(X`${q(label)} must resolve to a directory`);
    }
    return canonical;
  };

  /**
   * @param {string} root
   * @param {string} candidate
   * @returns {boolean}
   */
  const isWithinRoot = (root, candidate) => {
    const fromRoot = relativePath(root, candidate);
    return (
      fromRoot === '' ||
      (!isAbsolutePath(fromRoot) &&
        fromRoot !== '..' &&
        !fromRoot.startsWith(`..${pathSeparator}`))
    );
  };

  /**
   * @param {MountGrant} grant
   * @param {string} name
   * @param {string} cwd
   * @returns {Promise<NormalizedMountGrant>}
   */
  const normalizeMount = async (grant, name, cwd) => {
    assertProvisionBindingName(name, `Mount grant name ${name}`);
    const label = `EndoProvisionSpec.mounts.${name}`;
    const selector = assertPathString(grant.path, `${label}.path`);
    const root = await canonicalDirectory(
      resolvePath(cwd, selector),
      `${label}.path`,
    );
    return harden({
      root,
      mode: grant.mode,
      deniedSegments: normalizeDeniedSegments(
        grant.deniedSegments,
        `${label}.deniedSegments`,
      ),
      guestBinding: true,
    });
  };

  /**
   * @param {GitGrant} grant
   * @param {string} name
   * @param {Map<string, NormalizedMountGrant>} mounts
   * @param {string | undefined} pinnedRoot
   * @returns {Promise<NormalizedGitGrant>}
   */
  const normalizeGitGrant = async (grant, name, mounts, pinnedRoot) => {
    const label = `EndoProvisionSpec.gits.${name}`;
    const mountName = grant.mount ?? 'workspace';
    if (mountName !== 'workspace') {
      assertProvisionBindingName(mountName, `${label}.mount`);
    }
    const selectedMount = mounts.get(mountName);
    if (selectedMount === undefined) {
      throw makeError(
        X`${q(`${label}.mount`)} names an ungranted mount ${q(mountName)}`,
      );
    }
    const { mode } = grant;
    const writable = mode === 'readWrite' || mode === 'historyRewrite';
    if (selectedMount.mode === 'readOnly' && writable) {
      throw makeError(
        X`Git grant ${q(name)} cannot be ${q(mode)} on read-only mount ${q(mountName)}`,
      );
    }
    if (writable && !selectedMount.guestBinding) {
      throw makeError(
        X`writable Git grant ${q(name)} requires its selected mount ${q(mountName)} to be guest-bound (grant a workspace or named mount the guest can see)`,
      );
    }
    const path = grant.path.map((segment, index) => {
      if (
        segment === '.' ||
        segment === '..' ||
        segment.includes('/') ||
        segment.includes('\\') ||
        isAbsolutePath(segment)
      ) {
        throw makeError(
          X`${q(`${label}.path[${index}]`)} must be one relative path segment inside the selected mount`,
        );
      }
      if (selectedMount.deniedSegments.includes(segment.toLowerCase())) {
        throw makeError(
          X`${q(`${label}.path[${index}]`)} names a denied segment of mount ${q(mountName)}`,
        );
      }
      return segment;
    });
    // Persistence pins the canonical worktree root.
    // Revalidation must check that pinned root itself still exists and remains
    // confined, without
    // following a selector that may have been replaced by a symlink after
    // the first normalization.
    const root = await canonicalDirectory(
      pinnedRoot ?? resolvePath(selectedMount.root, ...path),
      `${label}.path`,
    );
    if (!isWithinRoot(selectedMount.root, root)) {
      throw makeError(
        X`${q(`${label}.path`)} must stay inside selected mount ${q(mountName)}`,
      );
    }
    return harden({ mount: mountName, path: harden([...path]), root, mode });
  };

  /**
   * @param {import('./provision-types.js').GitRemoteSpec} remote
   * @param {string} name
   * @returns {NormalizedGitRemoteSpec}
   */
  const normalizeRemote = (remote, name) => {
    assertProvisionBindingName(name, `Git remote name ${name}`);
    const label = `gitRemotes.${name}`;
    const policy = normalizeGitRemotePolicy({
      name,
      policy: /** @type {any} */ (remote),
    });
    const parsed = new URL(policy.url);
    for (const key of parsed.searchParams.keys()) {
      if (SECRET_NAME_RE.test(key)) {
        throw makeError(
          X`${q(`${label}.url`)} must not carry credential query fields`,
        );
      }
    }
    const credential =
      remote.credential === undefined
        ? undefined
        : normalizeCredentialPetNamePath(
            remote.credential,
            `${label}.credential`,
          );
    if (parsed.protocol === 'https:' && credential === undefined) {
      throw makeError(
        X`${q(`${label}.credential`)} must name a host credential for an https remote`,
      );
    }
    if (parsed.protocol !== 'https:' && credential !== undefined) {
      throw makeError(
        X`${q(`${label}.credential`)} is only valid for https remotes`,
      );
    }
    return harden({
      ...policy,
      ...(credential === undefined ? {} : { credential }),
    });
  };

  /**
   * @param {EndoProvisionSpec | undefined} specInput
   * @param {string} cwd
   * @param {Map<string, string>} [pinnedGitRoots]
   * @returns {Promise<{ workspacePath: string, policy: EndoProvisionPolicy }>}
   */
  const normalizePolicy = async (
    specInput,
    cwd,
    pinnedGitRoots = undefined,
  ) => {
    const spec = /** @type {EndoProvisionSpec} */ (asCopyData(specInput ?? {}));
    assertNoSecretFields(spec, 'EndoProvisionSpec');
    mustMatch(spec, EndoProvisionSpecShape, 'EndoProvisionSpec');
    const {
      workspace,
      git,
      mounts: mountsSpec = {},
      gits: gitsSpec = {},
      gitRemotes: remotesSpec,
      powers: powersSpec = {},
    } = spec;

    const canonicalCwd = await canonicalDirectory(resolvePath(cwd), 'cwd');
    const workspacePath = await canonicalDirectory(
      workspace?.path === undefined
        ? canonicalCwd
        : resolvePath(
            canonicalCwd,
            assertPathString(
              workspace.path,
              'EndoProvisionSpec.workspace.path',
            ),
          ),
      'EndoProvisionSpec.workspace.path',
    );
    const workspaceDeniedSegments = normalizeDeniedSegments(
      workspace?.deniedSegments,
      'EndoProvisionSpec.workspace.deniedSegments',
    );
    const workspaceMode = workspace?.mode;

    /** @type {Map<string, NormalizedMountGrant>} */
    const mounts = new Map();
    const mountNames = Object.keys(mountsSpec).sort();
    const normalizedMounts = await allInOrder(
      mountNames.map(name =>
        normalizeMount(mountsSpec[name], name, canonicalCwd),
      ),
    );
    mountNames.forEach((name, index) =>
      mounts.set(name, normalizedMounts[index]),
    );

    const workspaceGits = Object.values(gitsSpec).filter(
      grant => (grant.mount ?? 'workspace') === 'workspace',
    );
    const workspaceGitWritable = [
      ...(git === undefined ? [] : [git]),
      ...workspaceGits.map(grant => grant.mode),
    ].some(mode => mode === 'readWrite' || mode === 'historyRewrite');
    if (workspaceMode !== 'readWrite' && workspaceGitWritable) {
      throw makeError(
        X`writable Git requires workspace.mode: 'readWrite' or an explicit guest-bound writable mount; an omitted or read-only workspace cannot grant writable Git authority`,
      );
    }
    const needsWorkspaceMount =
      workspace !== undefined || git !== undefined || workspaceGits.length > 0;
    if (needsWorkspaceMount && !mounts.has('workspace')) {
      mounts.set(
        'workspace',
        harden({
          root: workspacePath,
          mode:
            workspaceMode === 'readWrite' || workspaceGitWritable
              ? 'readWrite'
              : 'readOnly',
          deniedSegments: workspaceDeniedSegments,
          guestBinding: workspace !== undefined,
        }),
      );
    }

    /** @type {Array<[string, Promise<NormalizedGitGrant>]>} */
    const gitJobs = [];
    if (git !== undefined) {
      gitJobs.push([
        'git',
        normalizeGitGrant(
          harden({ mount: 'workspace', path: [], mode: git }),
          'git',
          mounts,
          pinnedGitRoots?.get('git'),
        ),
      ]);
    }
    for (const name of Object.keys(gitsSpec).sort()) {
      assertProvisionBindingName(name, `Git grant name ${name}`);
      if (name === 'git') {
        throw makeError(
          X`Git grant name ${q(name)} is reserved for the compatibility root git input`,
        );
      }
      gitJobs.push([
        name,
        normalizeGitGrant(
          gitsSpec[name],
          name,
          mounts,
          pinnedGitRoots?.get(name),
        ),
      ]);
    }
    const normalizedGits = await allInOrder(gitJobs.map(([, job]) => job));
    const gits = /** @type {Record<string, NormalizedGitGrant>} */ (
      Object.fromEntries(
        gitJobs
          .map(([name], index) => [name, normalizedGits[index]])
          .sort(([left], [right]) => String(left).localeCompare(String(right))),
      )
    );

    if (remotesSpec !== undefined && git === undefined) {
      throw makeError(X`Git remotes require the compatibility root git grant`);
    }
    if (
      remotesSpec !== undefined &&
      git !== 'readWrite' &&
      git !== 'historyRewrite'
    ) {
      throw makeError(X`Git remotes require writable root Git authority`);
    }
    const gitRemotes = /** @type {Record<string, NormalizedGitRemoteSpec>} */ (
      Object.fromEntries(
        Object.keys(remotesSpec ?? {})
          .sort()
          .map(name => [
            name,
            normalizeRemote(
              /** @type {Record<string, any>} */ (remotesSpec)[name],
              name,
            ),
          ]),
      )
    );

    const powers = /** @type {Record<string, EndoProvisionPowerSpec>} */ (
      Object.fromEntries(
        Object.keys(powersSpec)
          .sort()
          .map(name => {
            assertProvisionBindingName(name, `Power name ${name}`);
            const { from } = powersSpec[name];
            if (!from.every(isPetName)) {
              throw makeError(
                X`powers.${q(name)}.from must be a non-empty host pet-name path`,
              );
            }
            return [name, harden({ from: harden([...from]) })];
          }),
      )
    );

    const allNames = new Set(mounts.keys());
    for (const name of Object.keys(gits)) {
      if (allNames.has(name)) {
        throw makeError(
          X`Binding name ${q(name)} is declared for both a mount and a Git grant`,
        );
      }
      allNames.add(name);
    }
    for (const name of Object.keys(gitRemotes)) {
      if (allNames.has(name)) {
        throw makeError(
          X`Binding name ${q(name)} is declared for a mount, Git grant, or remote more than once`,
        );
      }
      allNames.add(name);
    }
    for (const name of Object.keys(powers)) {
      if (allNames.has(name)) {
        if (Object.hasOwn(gitRemotes, name)) {
          throw makeError(
            X`Power name ${q(name)} conflicts with a provisioned Git remote binding`,
          );
        }
        throw makeError(
          X`Power name ${q(name)} conflicts with another provisioned binding`,
        );
      }
      allNames.add(name);
    }

    /** @type {EndoProvisionPolicy} */
    const policy = harden({
      mounts: harden(
        Object.fromEntries(
          [...mounts.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      ),
      ...(Object.keys(gits).length === 0 ? {} : { gits: harden(gits) }),
      ...(Object.keys(gitRemotes).length === 0
        ? {}
        : { gitRemotes: harden(gitRemotes) }),
      ...(Object.keys(powers).length === 0 ? {} : { powers: harden(powers) }),
    });
    return harden({ workspacePath, policy });
  };

  /**
   * Validate and re-normalize caller-held persistence before reconstruction.
   * This re-resolves every canonical root and every mount-relative Git
   * selector, so moved or symlink-swapped roots fail closed before host
   * realization.
   * The record must be an exact fixpoint of normalization.
   *
   * @param {unknown} value
   * @returns {Promise<EndoProvisionPersistence>}
   */
  const validateEndoProvisionPersistence = async value => {
    const record = /** @type {EndoProvisionPersistence} */ (asCopyData(value));
    mustMatch(
      record,
      EndoProvisionPersistenceShape,
      'Endo provision persistence',
    );
    const { guestHandlePath, workspacePath, policy } = record;
    if (
      guestHandlePath.length !== 4 ||
      guestHandlePath[0] !== 'provision' ||
      !SCOPE_KEY_RE.test(guestHandlePath[1]) ||
      !SESSION_KEY_RE.test(guestHandlePath[2]) ||
      guestHandlePath[3] !== 'guest-handle'
    ) {
      throw makeError(
        X`Endo provision persistence has an invalid guest handle path`,
      );
    }
    if (!isAbsolutePath(workspacePath)) {
      throw makeError(
        X`Endo provision persistence workspace path must be absolute`,
      );
    }

    // Accumulate entries and build records with `Object.fromEntries`, which
    // defines own properties: assignment onto a plain literal would trip
    // the prototype setter for an own `__proto__` key and drop that grant.
    /** @type {Array<[string, MountGrant]>} */
    const mountEntries = [];
    /** @type {{ path: string, mode: 'readOnly' | 'readWrite', deniedSegments: string[], guestBinding: boolean } | undefined} */
    let workspaceMount;
    /** @type {'readOnly' | 'readWrite' | 'historyRewrite' | undefined} */
    let rootGitMode;
    /** @type {Map<string, string>} */
    const pinnedGitRoots = new Map();
    for (const [name, mount] of Object.entries(policy.mounts)) {
      const label = `Endo provision persistence.policy.mounts.${name}`;
      if (!isAbsolutePath(mount.root)) {
        throw makeError(X`${q(`${label}.root`)} must be absolute`);
      }
      if (name === 'workspace') {
        workspaceMount = {
          path: mount.root,
          mode: mount.mode,
          deniedSegments: mount.deniedSegments,
          guestBinding: mount.guestBinding,
        };
      } else {
        if (!mount.guestBinding) {
          throw makeError(
            X`${q(label)} must be guest-bound when named explicitly`,
          );
        }
        mountEntries.push([
          name,
          {
            path: mount.root,
            mode: mount.mode,
            deniedSegments: mount.deniedSegments,
          },
        ]);
      }
    }
    /** @type {Record<string, MountGrant>} */
    const mounts = Object.fromEntries(mountEntries);

    /** @type {Array<[string, GitGrant]>} */
    const gitEntries = [];
    for (const [name, grant] of Object.entries(policy.gits ?? {})) {
      const label = `Endo provision persistence.policy.gits.${name}`;
      if (!isAbsolutePath(grant.root)) {
        throw makeError(X`${q(`${label}.root`)} must be absolute`);
      }
      if (name === 'git') {
        if (grant.mount !== 'workspace' || grant.path.length !== 0) {
          throw makeError(
            X`Persisted compatibility root git must select workspace at its root`,
          );
        }
        rootGitMode = grant.mode;
        pinnedGitRoots.set('git', grant.root);
      } else {
        pinnedGitRoots.set(name, grant.root);
        gitEntries.push([
          name,
          { mount: grant.mount, path: grant.path, mode: grant.mode },
        ]);
      }
    }
    /** @type {Record<string, GitGrant>} */
    const gits = Object.fromEntries(gitEntries);

    const reconstructedSpec = harden({
      ...(workspaceMount === undefined || !workspaceMount.guestBinding
        ? {}
        : {
            workspace: harden({
              path: workspaceMount.path,
              mode: workspaceMount.mode,
              deniedSegments: harden([...workspaceMount.deniedSegments]),
            }),
          }),
      ...(rootGitMode === undefined ? {} : { git: rootGitMode }),
      ...(Object.keys(mounts).length === 0 ? {} : { mounts }),
      ...(Object.keys(gits).length === 0 ? {} : { gits }),
      ...(policy.gitRemotes === undefined
        ? {}
        : { gitRemotes: policy.gitRemotes }),
      ...(policy.powers === undefined ? {} : { powers: policy.powers }),
    });
    const normalized = await normalizePolicy(
      /** @type {EndoProvisionSpec} */ (reconstructedSpec),
      workspacePath,
      pinnedGitRoots,
    );
    /** @type {EndoProvisionPersistence} */
    const persistence = harden({
      version: 1,
      guestHandlePath: harden([...guestHandlePath]),
      workspacePath: normalized.workspacePath,
      policy: normalized.policy,
    });
    if (!keyEQ(persistence, record)) {
      throw makeError(X`Endo provision persistence is not in normalized form`);
    }
    return persistence;
  };

  return harden({ normalizePolicy, validateEndoProvisionPersistence });
};
harden(makeProvisionPolicy);

/**
 * Make the host-side realizer behind `E(host).provision(persistence,
 * forkOptions?)`.
 * Receives the host's local functions and performs the
 * whole realization in-process: no CapTP round trips.
 *
 * Realization parallelizes independent items and keeps exactly two ordering
 * barriers: the policy record is persisted before any alias is minted, and
 * parent name directories are created before their children.
 *
 * @param {HostProvisionPowers} powers
 * @returns {(persistence: EndoProvisionPersistence, forkOptions?: EndoProvisionForkOptions) => Promise<EndoGuest>}
 */
export const makeHostProvision = powers => {
  const {
    pathPowers,
    has,
    identify,
    lookup,
    lookupById,
    makeDirectory,
    storeValue,
    storeIdentifier,
    provideMount,
    provideGit,
    provideGitRemote,
    provideGuest,
    getGitCredentialController,
    getGitRemoteController,
  } = powers;
  const policy =
    pathPowers === undefined ? undefined : makeProvisionPolicy(pathPowers);

  /**
   * Whether every prefix of the path resolves.
   * Local calls are cheap, so a
   * per-segment walk costs no round trips; walking prefixes avoids the
   * lookup error a missing intermediate directory would raise.
   *
   * @param {string[]} namePath
   * @returns {Promise<boolean>}
   */
  const hasNamePath = async namePath => {
    /**
     * @param {number} length
     * @returns {Promise<boolean>}
     */
    const walk = async length => {
      await null;
      if (length > namePath.length) {
        return true;
      }
      if (!(await has(...namePath.slice(0, length)))) {
        return false;
      }
      return walk(length + 1);
    };
    return walk(1);
  };

  /** @param {string[]} namePath */
  const ensureNameDirectory = async namePath => {
    await null;
    if (!(await hasNamePath(namePath))) {
      await makeDirectory(namePath);
    }
  };

  /**
   * @param {string[]} namePath
   * @param {() => Promise<unknown>} provide
   * @returns {Promise<unknown>}
   */
  const provideOrLookup = async (namePath, provide) => {
    await null;
    if (await hasNamePath(namePath)) {
      return lookup(namePath);
    }
    return provide();
  };

  /**
   * @param {EndoProvisionPersistence} persistence
   * @returns {Promise<Map<string, GitCredential>>}
   */
  const resolveGitCredentials = async persistence => {
    /** @type {Map<string, GitCredential>} */
    const credentials = new Map();
    await allInOrder(
      Object.entries(persistence.policy.gitRemotes ?? {}).map(
        async ([name, remote]) => {
          await null;
          if (remote.credential === undefined) {
            return;
          }
          let lookedUp;
          try {
            lookedUp = await lookup(remote.credential);
          } catch {
            throw new EndoCredentialUnavailableError(name, remote.credential);
          }
          const credential = /** @type {GitCredential} */ (lookedUp);
          let controller;
          try {
            controller = await getGitCredentialController(credential);
          } catch {
            throw makeError(
              X`Credential pet name ${q(JSON.stringify(remote.credential))} for remote ${q(name)} does not name a daemon-minted Git credential`,
            );
          }
          const inspection = await E(
            /** @type {GitCredentialController} */ (controller),
          ).inspect();
          if (
            !inspection ||
            inspection.available !== true ||
            inspection.revoked === true
          ) {
            throw new EndoCredentialUnavailableError(name, remote.credential);
          }
          const audience = await E(credential).audience();
          const expectedAudience = new URL(remote.url).origin;
          if (audience !== expectedAudience) {
            throw makeError(
              X`Credential audience ${q(audience)} does not match remote ${q(name)} audience ${q(expectedAudience)}`,
            );
          }
          credentials.set(name, credential);
        },
      ),
    );
    return credentials;
  };

  /**
   * @param {EndoProvisionPersistence} persistence
   * @returns {Promise<void>}
   */
  const assertRetainedPowerAliases = async persistence => {
    const controllerPath = persistence.guestHandlePath.slice(0, -1);
    await allInOrder(
      Object.keys(persistence.policy.powers ?? {}).map(async name => {
        await null;
        const alias = harden([...controllerPath, 'powers', name]);
        if (!(await hasNamePath(alias))) {
          throw makeError(
            X`Retained power ${q(name)} is missing; refusing to re-resolve its host source`,
          );
        }
      }),
    );
  };

  /**
   * Resolve each requested power once and retain its exact formula identifier.
   * Reusing that identifier prevents a concurrent host-name change from
   * substituting a different capability between resolution and retention.
   * For forks (`retained: true`) the identifiers come from the
   * parent's retained controller aliases rather than re-resolving its
   * source paths.
   *
   * @param {EndoProvisionPersistence} persistence
   * @param {{ retained: boolean }} options
   * @returns {Promise<Map<string, string>>}
   */
  const resolvePowerIdentifiers = async (persistence, { retained }) => {
    await null;
    const controllerPath = persistence.guestHandlePath.slice(0, -1);
    if (retained) {
      await assertRetainedPowerAliases(persistence);
    }
    const resolved = await allInOrder(
      Object.entries(persistence.policy.powers ?? {}).map(
        async ([name, power]) => {
          const from = retained
            ? harden([...controllerPath, 'powers', name])
            : power.from;
          const id = await identify(...from);
          if (typeof id !== 'string') {
            throw makeError(
              retained
                ? X`Retained power ${q(name)} has no formula identifier`
                : X`Power ${q(name)} source ${q(power.from.join('/'))} is not available on the host`,
            );
          }
          await lookupById(id);
          return /** @type {[string, string]} */ ([name, id]);
        },
      ),
    );
    return new Map(resolved);
  };

  /**
   * Validate a retained parent session and obtain the exact formula
   * identifiers retained by its controller aliases for a child fork.
   *
   * @param {(value: unknown) => Promise<EndoProvisionPersistence>} validatePersistence
   * @param {EndoProvisionPersistence} parentInput
   * @param {EndoProvisionPersistence} child - Already normalized.
   * @returns {Promise<Map<string, string>>}
   */
  const resolveForkPowerIdentifiers = async (
    validatePersistence,
    parentInput,
    child,
  ) => {
    const parent = await validatePersistence(parentInput);
    if (keyEQ(parent.guestHandlePath, child.guestHandlePath)) {
      throw makeError(
        X`Fork target must use a distinct retained guest namespace`,
      );
    }

    const parentPersistencePath = harden([
      ...parent.guestHandlePath.slice(0, -1),
      'persistence',
    ]);
    if (!(await hasNamePath(parentPersistencePath))) {
      throw makeError(
        X`Fork parent has no retained provision policy; refusing to copy powers`,
      );
    }
    const storedParent = await validatePersistence(
      await lookup(parentPersistencePath),
    );
    if (!keyEQ(storedParent, parent)) {
      throw makeError(
        X`Fork parent retained policy does not match the requested parent`,
      );
    }

    const childPersistencePath = harden([
      ...child.guestHandlePath.slice(0, -1),
      'persistence',
    ]);
    if (await hasNamePath(childPersistencePath)) {
      throw makeError(
        X`Fork target already has retained provision policy; refusing to copy powers`,
      );
    }

    if (
      !keyEQ(projectRuntimeAuthority(parent), projectRuntimeAuthority(child))
    ) {
      throw makeError(
        X`Fork provision policies select different runtime authority`,
      );
    }
    if (!keyEQ(parent.policy, child.policy)) {
      throw makeError(
        X`Fork provision policies have different session context`,
      );
    }

    return resolvePowerIdentifiers(parent, { retained: true });
  };

  /**
   * Realize every capability the policy grants under the controller
   * namespace and bind the guest-visible ones into the retained guest.
   *
   * @param {EndoProvisionPersistence} persistence
   * @param {Map<string, GitCredential>} credentials
   * @param {Map<string, string> | undefined} powerIdentifiersToInstall
   * @returns {Promise<EndoGuest>}
   */
  const realizeProvisionResources = async (
    persistence,
    credentials,
    powerIdentifiersToInstall,
  ) => {
    const controllerPath = persistence.guestHandlePath.slice(0, -1);
    const persistencePath = harden([...controllerPath, 'persistence']);
    /** @type {Array<[string, string[]]>} */
    const guestBindings = [];

    // Ordering barrier: parent name directories before children.
    await ensureNameDirectory(persistence.guestHandlePath.slice(0, 1));
    await ensureNameDirectory(persistence.guestHandlePath.slice(0, 2));
    await ensureNameDirectory(controllerPath);
    // Ordering barrier: record the authenticated policy before creating any
    // capability alias.
    // If provisioning is interrupted after this point, a
    // later attempt cannot reuse those aliases under a changed policy.
    if (!(await hasNamePath(persistencePath))) {
      await storeValue(persistence, persistencePath);
    }

    const realizeMounts = async () => {
      const mountsPath = harden([...controllerPath, 'mounts']);
      await ensureNameDirectory(mountsPath);
      const realized = await allInOrder(
        Object.entries(persistence.policy.mounts).map(async ([name, grant]) => {
          const mountPath = harden([...mountsPath, name]);
          const mountAlias = harden([...mountPath, 'mount']);
          await ensureNameDirectory(mountPath);
          const mount = /** @type {EndoMount} */ (
            await provideOrLookup(mountAlias, () =>
              provideMount(grant.root, mountAlias, {
                readOnly: grant.mode === 'readOnly',
                deniedSegments: grant.deniedSegments,
              }),
            )
          );
          if (grant.guestBinding) {
            guestBindings.push([name, mountAlias]);
          }
          return /** @type {[string, EndoMount]} */ ([name, mount]);
        }),
      );
      return new Map(realized);
    };

    /** @param {Map<string, EndoMount>} mounts */
    const realizeGits = async mounts => {
      const gitsPath = harden([...controllerPath, 'gits']);
      await ensureNameDirectory(gitsPath);
      const realized = await allInOrder(
        Object.entries(persistence.policy.gits ?? {}).map(
          async ([name, grant]) => {
            const grantPath = harden([...gitsPath, name]);
            const gitMountAlias = harden([...grantPath, 'mount']);
            const gitAlias = harden([...grantPath, 'git']);
            await ensureNameDirectory(grantPath);
            if (!mounts.has(grant.mount)) {
              throw makeError(
                X`Git grant ${q(name)} selects a mount that was not realized`,
              );
            }
            const gitMount = /** @type {EndoMount} */ (
              // A Git grant gets a fresh exact-root mount.
              // The selected named
              // mount is the authority ceiling; this derived mount prevents a
              // Git capability from silently covering unrelated paths in that
              // mount.
              await provideOrLookup(gitMountAlias, () =>
                provideMount(grant.root, gitMountAlias, {
                  readOnly: grant.mode === 'readOnly',
                  deniedSegments:
                    persistence.policy.mounts[grant.mount].deniedSegments,
                }),
              )
            );
            const git = await provideOrLookup(gitAlias, () =>
              provideGit(gitMount, gitAlias, {
                allowHistoryRewrite: grant.mode === 'historyRewrite',
                readOnly: grant.mode === 'readOnly',
              }),
            );
            guestBindings.push([name, gitAlias]);
            return /** @type {[string, unknown]} */ ([name, git]);
          },
        ),
      );
      return new Map(realized);
    };

    /** @param {Map<string, unknown>} gits */
    const realizeRemotes = async gits => {
      const remoteEntries = Object.entries(persistence.policy.gitRemotes ?? {});
      const rootGit = gits.get('git');
      if (rootGit === undefined) {
        if (remoteEntries.length > 0) {
          throw makeError(X`Git remotes have no retained root Git grant`);
        }
        return;
      }
      // Git remotes live under their own namespace container so a remote
      // name can never resolve to a trusted infrastructure sibling of
      // controllerPath (the persistence record, guest handle, or guest
      // agent).
      const remotesPath = harden([...controllerPath, 'remotes']);
      await ensureNameDirectory(remotesPath);
      await allInOrder(
        remoteEntries.map(async ([name, remote]) => {
          await null;
          const remoteAlias = harden([...remotesPath, name]);
          const remoteOptions = harden({
            name,
            url: remote.url,
            allowedDirections: remote.allowedDirections,
            fetchRefspecs: remote.fetchRefspecs,
            pushRefspecs: remote.pushRefspecs,
            ...(remote.defaultPullRef === undefined
              ? {}
              : { defaultPullRef: remote.defaultPullRef }),
            allowForcePush: remote.allowForcePush,
            allowTags: remote.allowTags,
            allowDelete: remote.allowDelete,
            allowLocalFileTransport: remote.allowLocalFileTransport,
            ...(remote.credential === undefined
              ? {}
              : { credential: credentials.get(name) }),
          });
          if (remote.credential === undefined) {
            await provideOrLookup(remoteAlias, () =>
              provideGitRemote(rootGit, remoteAlias, remoteOptions),
            );
          } else {
            // Replace a retained credentialed remote so its formula records
            // the current host credential formula ID instead of retaining
            // the ID from an earlier reprovisioning.
            if (await hasNamePath(remoteAlias)) {
              const previous = /** @type {GitRemote} */ (
                await lookup(remoteAlias)
              );
              const controller = /** @type {GitRemoteController} */ (
                await getGitRemoteController(previous)
              );
              await E(controller).revoke();
            }
            await provideGitRemote(rootGit, remoteAlias, remoteOptions);
          }
          guestBindings.push([name, remoteAlias]);
        }),
      );
    };

    const realizePowers = async () => {
      const powerNames = Object.keys(persistence.policy.powers ?? {});
      if (powerNames.length === 0) {
        return;
      }
      const powersPath = harden([...controllerPath, 'powers']);
      await ensureNameDirectory(powersPath);
      await allInOrder(
        powerNames.map(async name => {
          await null;
          const powerAlias = harden([...powersPath, name]);
          if (powerIdentifiersToInstall !== undefined) {
            if (await hasNamePath(powerAlias)) {
              throw makeError(
                X`Retained power ${q(name)} exists without a retained policy`,
              );
            }
            const id = powerIdentifiersToInstall.get(name);
            if (id === undefined) {
              throw makeError(X`No resolved formula for power ${q(name)}`);
            }
            await storeIdentifier(powerAlias, id);
          } else if (!(await hasNamePath(powerAlias))) {
            throw makeError(
              X`Retained power ${q(name)} is missing; refusing to re-resolve its host source`,
            );
          }
          guestBindings.push([name, powerAlias]);
        }),
      );
    };

    await allInOrder([
      realizeMounts().then(realizeGits).then(realizeRemotes),
      realizePowers(),
    ]);

    const guestAgentPath = harden([...controllerPath, 'guest-agent']);
    const [hasHandle, hasAgent] = await Promise.all([
      hasNamePath(persistence.guestHandlePath),
      hasNamePath(guestAgentPath),
    ]);
    if (hasHandle !== hasAgent) {
      throw makeError(
        X`Retained provisioned guest is incomplete; its handle and agent paths disagree`,
      );
    }
    const guest = /** @type {EndoGuest} */ (
      hasAgent
        ? await lookup(guestAgentPath)
        : await provideGuest(persistence.guestHandlePath, {
            agentName: guestAgentPath,
          })
    );

    await allInOrder(
      guestBindings.map(async ([guestName, controllerAlias]) => {
        const id = await identify(...controllerAlias);
        if (typeof id !== 'string') {
          throw makeError(
            X`Controller alias ${q(controllerAlias.join('/'))} has no formula identifier`,
          );
        }
        // Identifier sharing preserves the controller alias and binds the
        // exact same retained formula into the guest under its simple
        // lexical pet name.
        await E(guest).storeIdentifier(guestName, id);
      }),
    );
    return guest;
  };

  /**
   * Validate any retained policy before realizing its daemon-side
   * resources.
   *
   * @param {EndoProvisionPersistence} persistenceInput
   * @param {EndoProvisionForkOptions} [forkOptions]
   * @returns {Promise<EndoGuest>}
   */
  const provision = async (persistenceInput, forkOptions = undefined) => {
    if (policy === undefined) {
      throw makeError(
        X`Provisioning path powers are not wired into this daemon host`,
      );
    }
    const { validateEndoProvisionPersistence } = policy;
    const persistence =
      await validateEndoProvisionPersistence(persistenceInput);
    const persistencePath = harden([
      ...persistence.guestHandlePath.slice(0, -1),
      'persistence',
    ]);
    /** @type {Map<string, string> | undefined} */
    let powerIdentifiersToInstall;
    if (forkOptions?.forkFrom !== undefined) {
      powerIdentifiersToInstall = await resolveForkPowerIdentifiers(
        validateEndoProvisionPersistence,
        forkOptions.forkFrom,
        persistence,
      );
    } else if (await hasNamePath(persistencePath)) {
      const stored = await validateEndoProvisionPersistence(
        await lookup(persistencePath),
      );
      if (!keyEQ(stored, persistence)) {
        throw makeError(
          X`Reconstruction cannot widen or change a retained provision policy`,
        );
      }
      await assertRetainedPowerAliases(persistence);
    } else {
      powerIdentifiersToInstall = await resolvePowerIdentifiers(persistence, {
        retained: false,
      });
    }
    const credentials = await resolveGitCredentials(persistence);
    return realizeProvisionResources(
      persistence,
      credentials,
      powerIdentifiersToInstall,
    );
  };
  return harden(provision);
};
harden(makeHostProvision);
