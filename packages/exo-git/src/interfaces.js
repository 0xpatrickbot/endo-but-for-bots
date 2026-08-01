// @ts-check

import { M } from '@endo/patterns';

// #region Shape primitives

const GitDirectionShape = M.or(M.eq('fetch'), M.eq('push'));

const GitIndexStatusShape = M.or(
  'clean',
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'conflicted',
);

const GitWorktreeStatusShape = M.or(
  'clean',
  'modified',
  'deleted',
  'untracked',
  'ignored',
  'conflicted',
);

const GitStatusEntryShape = M.splitRecord(
  {
    entry: M.remotable(),
    path: M.string(),
    index: GitIndexStatusShape,
    worktree: GitWorktreeStatusShape,
  },
  {
    node: M.remotable(),
    renamedFrom: M.string(),
  },
);

const GitRefKindShape = M.or('branch', 'tag', 'commit', 'detached');

const GitRefShape = M.splitRecord(
  {
    name: M.string(),
    kind: GitRefKindShape,
  },
  {
    oid: M.string(),
  },
);
const RefArgShape = M.or(M.string(), GitRefShape);

const GitCommitShape = M.splitRecord(
  {
    oid: M.string(),
    summary: M.string(),
  },
  {
    author: M.string(),
    committedAt: M.number(),
  },
);

const GitCommitOptionsShape = M.splitRecord(
  {},
  {
    amend: M.boolean(),
  },
  harden({}),
);

const GitCherryPickOptionsShape = M.splitRecord(
  {},
  { noCommit: M.boolean() },
  harden({}),
);

export const GitRebaseStartInputShape = M.splitRecord(
  { mode: 'start', upstream: M.string() },
  { autosquash: M.boolean() },
  harden({}),
);
harden(GitRebaseStartInputShape);

const GitRebaseControlInputShape = M.splitRecord(
  { mode: M.or('continue', 'abort', 'skip') },
  {},
  harden({}),
);

const GitRebaseInputShape = M.or(
  GitRebaseStartInputShape,
  GitRebaseControlInputShape,
);

// `GitReadWriteCommitOptionsShape` is the argument-sensitive authority split:
// the writer facet's `commit` accepts `amend` only as an explicit `false` (or
// omitted), so a caller holding ordinary write authority can never smuggle a
// history rewrite past the guard by supplying `amend: true`. The rewriter
// facet uses the unrestricted `GitCommitOptionsShape` below instead.
const GitReadWriteCommitOptionsShape = M.splitRecord(
  {},
  { amend: M.eq(false) },
  harden({}),
);

// `scope`'s closed vocabulary is a strict, per-facet subset: a facet may
// only select itself or a lower-authority sibling, never a higher one — the
// guard itself is the escalation barrier, not a runtime check in the method
// body. An unrecognized name and an escalation attempt reject with the same
// guard-rejection shape.
const GitReaderScopeNameShape = M.eq('reader');
const GitWriterScopeNameShape = M.or('reader', 'writer');
const GitRewriterScopeNameShape = M.or('reader', 'writer', 'rewriter');

// #endregion

/**
 * The single per-method guard table every facet interface is generated
 * from. A facet's `M.interface(...)` is a projection of this table (see
 * `pickGuards` below), not an independently hand-written duplicate: adding or
 * reshaping a method here is the one edit that reaches every facet guard,
 * the `GitInterface` compatibility export, and (via the conformance test in
 * `test/kit-conformance.test.js`) the checked-in `types.ts` and generated
 * code-mode prompt surfaces that must stay aligned with it.
 *
 * `commit` is entered twice because its guard is the one argument-sensitive
 * authority split in the whole table (`amend`); every other method has
 * exactly one guard shared by every facet that carries it.
 */
export const GIT_METHOD_GUARDS = harden({
  // `callWhen` so a read-only Git may resolve its worktree authority
  // through `mount.readOnly()` (which yields a promise of the
  // structural read-only view) before the return shape is matched; a
  // writable Git returns its mount synchronously and is unaffected.
  worktree: M.callWhen().returns(M.remotable()),
  status: M.callWhen().returns(M.arrayOf(GitStatusEntryShape)),
  diff: M.callWhen()
    .optional(M.recordOf(M.string(), M.any()))
    .returns(M.string()),
  log: M.callWhen()
    .optional(M.recordOf(M.string(), M.any()))
    .returns(M.arrayOf(GitCommitShape)),
  show: M.callWhen(RefArgShape).returns(M.string()),
  revParse: M.callWhen(RefArgShape).returns(GitRefShape),
  currentBranch: M.callWhen().returns(M.or(GitRefShape, M.undefined())),
  branches: M.callWhen().returns(M.arrayOf(GitRefShape)),
  stashList: M.callWhen().returns(M.arrayOf(M.string())),
  stashShow: M.callWhen().optional(M.number()).returns(M.string()),
  tree: M.callWhen(RefArgShape).returns(M.remotable()),
  filesystemAt: M.callWhen(RefArgShape).returns(M.remotable('Filesystem')),
  scopeReader: M.call(GitReaderScopeNameShape).returns(M.remotable('Git')),
  scopeWriter: M.call(GitWriterScopeNameShape).returns(M.remotable('Git')),
  scopeRewriter: M.call(GitRewriterScopeNameShape).returns(M.remotable('Git')),
  readOnly: M.call().returns(M.remotable('Git')),

  add: M.callWhen(M.arrayOf(M.remotable())).returns(M.undefined()),
  restore: M.callWhen(M.arrayOf(M.remotable()))
    .optional(M.recordOf(M.string(), M.any()))
    .returns(M.undefined()),
  commitReadWrite: M.callWhen(M.string())
    .optional(GitReadWriteCommitOptionsShape)
    .returns(GitCommitShape),
  createBranch: M.callWhen(M.string())
    .optional(M.recordOf(M.string(), M.any()))
    .returns(GitRefShape),
  deleteBranch: M.callWhen(M.string())
    .optional(M.recordOf(M.string(), M.any()))
    .returns(M.undefined()),
  renameBranch: M.callWhen(M.string(), M.string()).returns(M.undefined()),
  switchBranch: M.callWhen(M.string()).returns(M.undefined()),
  detach: M.callWhen(RefArgShape).returns(M.undefined()),
  switch: M.callWhen(RefArgShape).returns(M.undefined()),
  merge: M.callWhen(RefArgShape)
    .optional(M.recordOf(M.string(), M.any()))
    .returns(M.string()),
  stashPush: M.callWhen()
    .optional(M.recordOf(M.string(), M.any()))
    .returns(M.string()),
  stashApply: M.callWhen().optional(M.number()).returns(M.undefined()),
  stashPop: M.callWhen().optional(M.number()).returns(M.undefined()),
  stashDrop: M.callWhen().optional(M.number()).returns(M.undefined()),

  commit: M.callWhen(M.string())
    .optional(GitCommitOptionsShape)
    .returns(GitCommitShape),
  reword: M.callWhen(RefArgShape, M.string()).returns(GitCommitShape),
  cherryPick: M.callWhen(RefArgShape)
    .optional(GitCherryPickOptionsShape)
    .returns(M.string()),
  rebase: M.callWhen(GitRebaseInputShape).returns(M.string()),
});

/**
 * Facet membership: every reader method name also appears in
 * `GIT_WRITER_METHODS`, and every writer method name also appears in
 * `GIT_REWRITER_METHODS` — the cumulative-facet requirement expressed as
 * data instead of three independently maintained method lists.
 */
export const GIT_READER_METHODS = harden([
  'worktree',
  'status',
  'diff',
  'log',
  'show',
  'revParse',
  'currentBranch',
  'branches',
  'stashList',
  'stashShow',
  'tree',
  'filesystemAt',
  'scope',
  'readOnly',
]);

export const GIT_WRITER_ONLY_METHODS = harden([
  'add',
  'restore',
  'createBranch',
  'deleteBranch',
  'renameBranch',
  'switchBranch',
  'detach',
  'switch',
  'merge',
  'stashPush',
  'stashApply',
  'stashPop',
  'stashDrop',
]);
export const GIT_WRITER_METHODS = harden([
  ...GIT_READER_METHODS,
  ...GIT_WRITER_ONLY_METHODS,
  'commit',
]);

export const GIT_REWRITER_ONLY_METHODS = harden([
  'reword',
  'cherryPick',
  'rebase',
]);
export const GIT_REWRITER_METHODS = harden([
  ...GIT_WRITER_METHODS,
  ...GIT_REWRITER_ONLY_METHODS,
]);

/** @type {Record<'reader' | 'writer' | 'rewriter', string>} */
const SCOPE_GUARD_NAME_BY_LEVEL = harden({
  reader: 'scopeReader',
  writer: 'scopeWriter',
  rewriter: 'scopeRewriter',
});

/**
 * Project `GIT_METHOD_GUARDS` onto a named method list, substituting the two
 * argument-sensitive guards (`commit`'s amend split, `scope`'s per-facet
 * closed vocabulary) for the requested authority level.
 *
 * @param {readonly string[]} methodNames
 * @param {'reader' | 'writer' | 'rewriter'} level
 * @returns {Record<string, import('@endo/patterns').MethodGuard>}
 */
const pickGuards = (methodNames, level) =>
  Object.fromEntries(
    methodNames.map(name => {
      if (name === 'commit' && level === 'writer') {
        return [name, GIT_METHOD_GUARDS.commitReadWrite];
      }
      if (name === 'scope') {
        return [name, GIT_METHOD_GUARDS[SCOPE_GUARD_NAME_BY_LEVEL[level]]];
      }
      return [name, GIT_METHOD_GUARDS[name]];
    }),
  );

export const GitReaderInterface = M.interface(
  'GitReader',
  pickGuards(GIT_READER_METHODS, 'reader'),
);

export const GitWriterInterface = M.interface(
  'GitWriter',
  pickGuards(GIT_WRITER_METHODS, 'writer'),
);

export const GitRewriterInterface = M.interface(
  'GitRewriter',
  pickGuards(GIT_REWRITER_METHODS, 'rewriter'),
);

/**
 * Compatibility export: the full method set (equivalent to
 * `GitRewriterInterface`, retagged) for consumers that still walk a single
 * flat Git guard rather than the three-facet kit (`@endo/agent-tools`'s
 * JSON-tool and code-mode prompt generation).
 */
export const GitInterface = M.interface(
  'Git',
  pickGuards(GIT_REWRITER_METHODS, 'rewriter'),
);

export const GitTreeInterface = M.interface('EndoGitTree', {
  archiveTar: M.call().returns(M.remotable()),
  // `callWhen` so the settled value (not the promise) is guarded against
  // the return shape, matching the GitInterface convention above.
  archiveLossless: M.callWhen().returns(M.boolean()),
  has: M.callWhen().rest(M.arrayOf(M.string())).returns(M.boolean()),
  list: M.callWhen().rest(M.arrayOf(M.string())).returns(M.arrayOf(M.string())),
  lookup: M.callWhen(M.or(M.string(), M.arrayOf(M.string()))).returns(
    M.remotable(),
  ),
});

export const GitRemoteInterface = M.interface('GitRemote', {
  inspect: M.call().returns(M.promise()),
  fetch: M.call()
    .optional(M.recordOf(M.string(), M.any()))
    .returns(M.promise()),
  pull: M.call().optional(M.recordOf(M.string(), M.any())).returns(M.promise()),
  push: M.call().optional(M.recordOf(M.string(), M.any())).returns(M.promise()),
});

export const GitRemoteControllerInterface = M.interface('GitRemoteController', {
  inspect: M.call().returns(M.promise()),
  audit: M.call().returns(M.promise()),
  setAllowedDirections: M.call(M.arrayOf(GitDirectionShape)).returns(
    M.promise(),
  ),
  setFetchRefspecs: M.call(M.arrayOf(M.string())).returns(M.promise()),
  setPushRefspecs: M.call(M.arrayOf(M.string())).returns(M.promise()),
  setAllowedBranches: M.call(M.arrayOf(M.string())).returns(M.promise()),
  setAllowForcePush: M.call(M.boolean()).returns(M.promise()),
  setAllowTags: M.call(M.boolean()).returns(M.promise()),
  setAllowDelete: M.call(M.boolean()).returns(M.promise()),
  revoke: M.call().returns(M.promise()),
});

export const GitCredentialControllerInterface = M.interface(
  'GitCredentialController',
  {
    inspect: M.call().returns(M.promise()),
    rotate: M.call(M.recordOf(M.string(), M.any())).returns(M.promise()),
    revoke: M.call().returns(M.promise()),
  },
);

export const BearerCredentialInterface = M.interface('BearerCredential', {
  audience: M.call().returns(M.string()),
});

export const BasicCredentialInterface = M.interface('BasicCredential', {
  audience: M.call().returns(M.string()),
});
