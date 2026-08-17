// @ts-check
/// <reference types="ses"/>

/**
 * GENERATED FILE - do not edit by hand.
 *
 * Regenerate with: yarn workspace @endo/agent-tools gen:code-mode-types
 *
 * Source of truth:
 *   - gitRemote: packages/exo-git/src/types.ts (the `GitRemote` type alias),
 *     printed by the TypeScript compiler API.
 *
 * The generic extraction and rendering live in
 * scripts/code-mode-type-extract.js; this exo's source configuration lives in
 * its scripts/code-mode-*-extract.js extractor. The divergence gate in
 * test/code-mode-types.test.js keeps this artifact fresh.
 *
 * Each entry is consumed by formatGlobalDeclarations in code-mode/declarations.js via
 * the per-exo descriptor in code-mode-globals/git-remote.js:
 * `aux` is the supporting `type` aliases, `body` is the object type spliced
 * after the dynamic `declare const <name>:`.
 */

export const gitRemoteDeclarations = harden({
  gitRemote: {
    aux: `type GitRemote = {
    fetch: (options?: {
        prune?: boolean;
        tags?: boolean;
    }) => Promise<RemoteOperationResult>;
    inspect: () => Promise<RemoteSnapshot>;
    pull: (options?: {
        branch?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        strategy?: 'merge' | 'rebase' | 'ff-only';
        prune?: boolean;
        tags?: boolean;
    }) => Promise<RemotePullResult>;
    push: (options?: {
        refspecs?: string[];
        source?: string;
        destination?: string;
        force?: boolean;
        forceWithLease?: string;
        setUpstream?: boolean;
    }) => Promise<RemoteOperationResult>;
};
type RemoteOperationResult = {
    updatedRefs: RemoteRefUpdate[];
    text: string;
};
type RemoteRefUpdate = {
    local?: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    };
    remote: string;
    result: 'created' | 'updated' | 'up-to-date' | 'fast-forward' | 'forced' | 'pruned' | 'rejected';
};
type RemoteSnapshot = RemoteNormalizedRemotePolicy & {
    name: string;
};
type RemoteNormalizedRemotePolicy = RemotePolicy & Required<Pick<RemotePolicy, 'allowForcePush' | 'allowTags' | 'allowDelete' | 'allowLocalFileTransport'>>;
type RemotePolicy = {
    url: string;
    allowedDirections: ('fetch' | 'push')[];
    fetchRefspecs: string[];
    pushRefspecs: string[];
    defaultPullRef?: string;
    allowedBranches?: string[];
    allowForcePush?: boolean;
    allowTags?: boolean;
    allowDelete?: boolean;
    allowLocalFileTransport?: boolean;
};
type RemotePullResult = {
    fetch: RemoteOperationResult;
    integration: 'up-to-date' | 'fast-forward' | 'merge' | 'rebase';
    head: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    };
};`,
    body: `GitRemote`,
  },
});
harden(gitRemoteDeclarations);
