// @ts-check
/// <reference types="ses"/>

/**
 * GENERATED FILE - do not edit by hand.
 *
 * Regenerate with: yarn workspace @endo/agent-tools gen:code-mode-types
 *
 * Source of truth:
 *   - git / gitHistory / gitReadOnly: packages/exo-git/src/types.ts (the
 *     `ReadWriteEndoGit`, `HistoryRewriteEndoGit`, and `ReadOnlyEndoGit`
 *     type alias), printed by the typescript compiler API
 *     (TypeScript-canonical).
 *
 * The generic extraction and rendering live in
 * scripts/code-mode-type-extract.js; this exo's source configuration lives in
 * its scripts/code-mode-*-extract.js extractor. The divergence gate in
 * test/code-mode-types.test.js keeps this artifact fresh.
 *
 * Each entry is consumed by formatGlobalDeclarations in code-mode/declarations.js via
 * the per-exo descriptor in code-mode-globals/git.js:
 * `aux` is the supporting `type` aliases, `body` is the object type spliced
 * after the dynamic `declare const <name>:`.
 */

export const gitDeclarations = harden({
  git: {
    aux: `type GitDirectoryEntry = {
    name: string;
    kind: 'file';
    qid: {
        type: 'file';
        pathId: bigint;
        version: bigint;
    };
} | {
    name: string;
    kind: 'directory';
    qid: {
        type: 'directory';
        pathId: bigint;
        version: bigint;
    };
};
type GitERef<T> = T | Promise<T>;
type GitExtendedDirectory = {
    getQid: () => {
        type: 'directory';
        pathId: bigint;
        version: bigint;
    };
    getStat: () => Promise<{
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    }>;
    setStat: (patch: {
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    }) => Promise<void>;
    getAttrs: () => Promise<{
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    } & {
        ctime?: bigint;
        btime?: bigint | null;
    }>;
    setAttrs: (patch: {
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    }) => Promise<void>;
    watch: () => GitERef<{
        events: () => GitERef<GitPassableReader<GitWatchEvent>>;
        cancel: () => Promise<void>;
    }>;
    xattrs: () => GitERef<{
        get: (name: string) => GitERef<GitPassableBytesReader>;
        set: (name: string, opts?: {
            existence?: 'create' | 'replace';
        }) => GitERef<{
            streamBase64: (synPromise: GitERef<GitStreamNode<string, undefined>>) => Promise<GitStreamNode<undefined, undefined>>;
            writeReturnPattern: () => unknown | undefined;
        }>;
        list: () => GitERef<GitPassableReader<string>>;
        remove: (name: string) => Promise<void>;
        help: (method?: string) => string;
    }>;
    lookup: (nameOrPath: string | readonly string[]) => GitERef<GitExtendedDirectory | GitExtendedFile>;
    lookupStep: (name: string) => GitERef<GitExtendedDirectory | GitExtendedFile>;
    subView: (nameOrPath: string | readonly string[]) => GitERef<GitExtendedDirectory>;
    list: () => GitERef<{
        read: (limit?: bigint) => Promise<{
            entries: GitDirectoryEntry[];
            atEnd: boolean;
        }>;
        stream: () => GitERef<GitPassableReader<GitDirectoryEntry>>;
        toArray: () => Promise<GitDirectoryEntry[]>;
        skip: (n: bigint) => Promise<void>;
        rewind: () => Promise<void>;
        close: () => Promise<void>;
        help: (method?: string) => string;
    }>;
    write: (name: string, value: string) => Promise<void>;
    create: (name: string, opts?: {
        read?: boolean;
        write?: boolean;
        create?: boolean;
        truncate?: boolean;
        append?: boolean;
    }) => GitERef<{
        read: (offset?: bigint, length?: bigint) => GitERef<GitPassableBytesReader>;
        write: (offset?: bigint) => GitERef<{
            streamBase64: (synPromise: GitERef<GitStreamNode<string, undefined>>) => Promise<GitStreamNode<undefined, undefined>>;
            writeReturnPattern: () => unknown | undefined;
        }>;
        truncate: (size: bigint) => Promise<void>;
        fsync: () => Promise<void>;
        lock: (opts: GitLockOpts) => GitERef<GitLock>;
        getLock: (opts: GitLockQuery) => Promise<GitLockState | null>;
        close: () => Promise<void>;
        help: (method?: string) => string;
    }>;
    makeDirectory: (name: string) => GitERef<GitExtendedDirectory>;
    mkdir: (name: string) => GitERef<GitExtendedDirectory>;
    remove: (name: string) => Promise<void>;
    unlink: (name: string) => Promise<void>;
    move: (fromPath: string | readonly string[], toPath: string | readonly string[]) => Promise<void>;
    copy: (fromPath: string | readonly string[], toPath: string | readonly string[]) => Promise<void>;
    rename: (oldName: string, newParent: GitERef<GitExtendedDirectory>, newName: string) => Promise<void>;
    fsync: () => Promise<void>;
    materialise: (path: readonly string[]) => GitERef<GitExtendedDirectory>;
    watchFrom: () => GitERef<{
        cursor: {
            read: (limit?: bigint) => Promise<{
                entries: GitDirectoryEntry[];
                atEnd: boolean;
            }>;
            stream: () => GitERef<GitPassableReader<GitDirectoryEntry>>;
            toArray: () => Promise<GitDirectoryEntry[]>;
            skip: (n: bigint) => Promise<void>;
            rewind: () => Promise<void>;
            close: () => Promise<void>;
            help: (method?: string) => string;
        };
        watcher: {
            events: () => GitERef<GitPassableReader<GitWatchEvent>>;
            cancel: () => Promise<void>;
        };
    }>;
    help: (method?: string) => string;
};
type GitExtendedFile = {
    getQid: () => {
        type: 'file';
        pathId: bigint;
        version: bigint;
    };
    getStat: () => Promise<{
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    }>;
    setStat: (patch: {
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    }) => Promise<void>;
    getAttrs: () => Promise<{
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    } & {
        ctime?: bigint;
        btime?: bigint | null;
    }>;
    setAttrs: (patch: {
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    }) => Promise<void>;
    watch: () => GitERef<{
        events: () => GitERef<GitPassableReader<GitWatchEvent>>;
        cancel: () => Promise<void>;
    }>;
    xattrs: () => GitERef<{
        get: (name: string) => GitERef<GitPassableBytesReader>;
        set: (name: string, opts?: {
            existence?: 'create' | 'replace';
        }) => GitERef<{
            streamBase64: (synPromise: GitERef<GitStreamNode<string, undefined>>) => Promise<GitStreamNode<undefined, undefined>>;
            writeReturnPattern: () => unknown | undefined;
        }>;
        list: () => GitERef<GitPassableReader<string>>;
        remove: (name: string) => Promise<void>;
        help: (method?: string) => string;
    }>;
    open: (opts?: {
        read?: boolean;
        write?: boolean;
        create?: boolean;
        truncate?: boolean;
        append?: boolean;
    }) => GitERef<{
        read: (offset?: bigint, length?: bigint) => GitERef<GitPassableBytesReader>;
        write: (offset?: bigint) => GitERef<{
            streamBase64: (synPromise: GitERef<GitStreamNode<string, undefined>>) => Promise<GitStreamNode<undefined, undefined>>;
            writeReturnPattern: () => unknown | undefined;
        }>;
        truncate: (size: bigint) => Promise<void>;
        fsync: () => Promise<void>;
        lock: (opts: GitLockOpts) => GitERef<GitLock>;
        getLock: (opts: GitLockQuery) => Promise<GitLockState | null>;
        close: () => Promise<void>;
        help: (method?: string) => string;
    }>;
    read: (opts?: {
        offset?: bigint;
        length?: bigint;
    }) => GitERef<GitPassableBytesReader>;
    write: (opts?: {
        offset?: bigint;
    }) => GitERef<{
        streamBase64: (synPromise: GitERef<GitStreamNode<string, undefined>>) => Promise<GitStreamNode<undefined, undefined>>;
        writeReturnPattern: () => unknown | undefined;
    }>;
    snapshot: () => Promise<{
        getInfo: () => {
            algorithm: string;
            hash: string;
            size: bigint;
        };
        fetch: (offset: bigint, length: bigint) => GitERef<GitPassableBytesReader>;
        text: () => Promise<string>;
        json: () => Promise<unknown>;
        help: (method?: string) => string;
    }>;
    help: (method?: string) => string;
};
type GitLiteDirectory = {
    has: (...path: string[]) => Promise<boolean>;
    list: (...path: string[]) => Promise<string[]>;
    lookup: (path: string | string[]) => Promise<unknown>;
    write: (path: string[], value: {
        streamBase64: (...args: any[]) => PromiseLike<unknown>;
    } | {
        has: (...petNamePath: string[]) => Promise<boolean>;
        list: (...petNamePath: string[]) => Promise<readonly string[]>;
        lookup: (petNamePath: string | readonly string[]) => Promise<unknown>;
        listTree?: (petNamePath: string | readonly string[], options?: {
            ignore?: readonly string[];
        }) => Promise<{
            path: string[];
            type: 'file' | 'directory';
        }[]>;
    }) => Promise<void>;
    remove: (path: string[]) => Promise<void>;
    move: (from: string[], to: string[]) => Promise<void>;
    copy: (from: string[], to: string[]) => Promise<void>;
    makeDirectory: (path: string[]) => Promise<GitLiteDirectory>;
    readOnly: () => {
        has: (...petNamePath: string[]) => Promise<boolean>;
        list: (...petNamePath: string[]) => Promise<readonly string[]>;
        lookup: (petNamePath: string | readonly string[]) => Promise<unknown>;
        listTree?: (petNamePath: string | readonly string[], options?: {
            ignore?: readonly string[];
        }) => Promise<{
            path: string[];
            type: 'file' | 'directory';
        }[]>;
    };
    snapshot: () => Promise<{
        has: (...petNamePath: string[]) => Promise<boolean>;
        list: (...petNamePath: string[]) => Promise<readonly string[]>;
        lookup: (petNamePath: string | readonly string[]) => Promise<unknown>;
        listTree?: (petNamePath: string | readonly string[], options?: {
            ignore?: readonly string[];
        }) => Promise<{
            path: string[];
            type: 'file' | 'directory';
        }[]>;
    } & {
        sha256: () => string;
        getInfo: () => Promise<{
            algorithm: string;
            hash: string;
            size: bigint;
        }>;
    }>;
};
type GitLitePathEntry = {
    segments: () => string[];
    displayPath: () => string;
    child: (name: string) => GitLitePathEntry;
    help: (method?: string) => string;
};
type GitLock = {
    release: () => Promise<void>;
    help: (method?: string) => string;
};
type GitLockOpts = {
    type: 'shared' | 'exclusive';
    start?: bigint;
    length?: bigint;
};
type GitLockQuery = {
    start?: bigint;
    length?: bigint;
};
type GitLockState = {
    type: 'shared' | 'exclusive';
    start: bigint;
    length: bigint;
};
type GitPassableBytesReader<TReadReturn = undefined> = {
    streamBase64: (synPromise: GitERef<GitStreamNode<unknown, TReadReturn>>) => Promise<GitStreamNode<string, TReadReturn>>;
    readReturnPattern: () => unknown | undefined;
};
type GitPassableReader<TRead = unknown, TReadReturn = unknown> = {
    stream: (synPromise: GitERef<GitStreamNode<undefined, TReadReturn>>) => Promise<GitStreamNode<TRead, TReadReturn>>;
    readPattern: () => unknown | undefined;
    readReturnPattern: () => unknown | undefined;
};
type GitReadOnlyEndoGit = {
    worktree: () => Promise<{
        has: (...petNamePath: string[]) => Promise<boolean>;
        list: (...petNamePath: string[]) => Promise<readonly string[]>;
        lookup: (petNamePath: string | readonly string[]) => Promise<unknown>;
        listTree?: (petNamePath: string | readonly string[], options?: {
            ignore?: readonly string[];
        }) => Promise<{
            path: string[];
            type: 'file' | 'directory';
        }[]>;
    }>;
    status: (options?: {
        untracked?: 'all' | 'normal' | 'no';
        maxCount?: number;
    }) => Promise<{
        entries: {
            path: string;
            index: 'clean' | 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'conflicted';
            worktree: 'clean' | 'modified' | 'deleted' | 'untracked' | 'ignored' | 'conflicted';
            renamedFrom?: string;
        }[];
        truncated: boolean;
    }>;
    trackingStatus: () => Promise<{
        branch?: string;
        upstream?: string;
        ahead: number;
        behind: number;
        detached: boolean;
    }>;
    diff: (options?: {
        cached?: boolean;
        base?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        head?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        entries?: GitLitePathEntry[];
        paths?: string[];
    }) => Promise<string>;
    log: (options?: {
        maxCount?: number;
        ref?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        since?: string;
        until?: string;
    }) => Promise<{
        oid: string;
        summary: string;
        author?: string;
        committedAt?: number;
    }[]>;
    show: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<string>;
    revParse: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    }>;
    currentBranch: () => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | undefined>;
    branches: () => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    }[]>;
    stashList: () => Promise<string[]>;
    stashShow: (index?: number) => Promise<string>;
    tree: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<{
        has: (...petNamePath: string[]) => Promise<boolean>;
        list: (...petNamePath: string[]) => Promise<readonly string[]>;
        lookup: (petNamePath: string | readonly string[]) => Promise<unknown>;
        listTree?: (petNamePath: string | readonly string[], options?: {
            ignore?: readonly string[];
        }) => Promise<{
            path: string[];
            type: 'file' | 'directory';
        }[]>;
    }>;
    filesystemAt: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<{
        root: () => GitERef<GitExtendedDirectory>;
        named: (name: string) => GitERef<GitExtendedDirectory>;
        statfs: () => Promise<{
            blockSize?: bigint;
            totalBlocks?: bigint;
            freeBlocks?: bigint;
            totalBytes?: bigint;
            freeBytes?: bigint;
            files?: bigint;
            directories?: bigint;
            type?: string;
        }>;
        brands: () => Promise<ReadonlySet<bigint> | readonly bigint[]>;
        help: (method?: string) => string;
    }>;
    readOnly: () => GitReadOnlyEndoGit;
    scope: (name: 'reader') => GitReadOnlyEndoGit;
};
type GitStreamNode<Y = undefined, R = undefined> = GitStreamYieldNode<Y, R> | {
    value: R;
    promise: null;
};
type GitStreamYieldNode<Y = unknown, R = undefined> = {
    value: Y;
    promise: Promise<GitStreamNode<Y, R>>;
};
type GitWatchEvent = {
    kind: 'changed' | 'created' | 'removed' | 'child-added' | 'child-removed';
    name?: string;
};`,
    body: `{
    add: (entries: GitLitePathEntry[]) => Promise<void>;
    branches: () => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    }[]>;
    checkoutConflict: (entries: GitLitePathEntry[], side: 'ours' | 'theirs') => Promise<void>;
    commit: (message: string) => Promise<{
        oid: string;
        summary: string;
        author?: string;
        committedAt?: number;
    }>;
    createBranch: (name: string, options?: {
        startPoint?: string;
        switchAfterCreate?: boolean;
    }) => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    }>;
    currentBranch: () => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | undefined>;
    deleteBranch: (name: string, options?: {
        force?: boolean;
    }) => Promise<void>;
    detach: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<void>;
    diff: (options?: {
        cached?: boolean;
        base?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        head?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        entries?: GitLitePathEntry[];
        paths?: string[];
    }) => Promise<string>;
    filesystemAt: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<{
        root: () => GitERef<GitExtendedDirectory>;
        named: (name: string) => GitERef<GitExtendedDirectory>;
        statfs: () => Promise<{
            blockSize?: bigint;
            totalBlocks?: bigint;
            freeBlocks?: bigint;
            totalBytes?: bigint;
            freeBytes?: bigint;
            files?: bigint;
            directories?: bigint;
            type?: string;
        }>;
        brands: () => Promise<ReadonlySet<bigint> | readonly bigint[]>;
        help: (method?: string) => string;
    }>;
    log: (options?: {
        maxCount?: number;
        ref?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        since?: string;
        until?: string;
    }) => Promise<{
        oid: string;
        summary: string;
        author?: string;
        committedAt?: number;
    }[]>;
    merge: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string, options?: {
        fastForwardOnly?: boolean;
        noFastForward?: boolean;
    }) => Promise<string>;
    readOnly: () => GitReadOnlyEndoGit;
    renameBranch: (from: string, to: string) => Promise<void>;
    restore: (entries: GitLitePathEntry[], options?: {
        staged?: boolean;
    }) => Promise<void>;
    revParse: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    }>;
    scope: (name: 'reader' | 'writer') => GitReadOnlyEndoGit | typeof git;
    show: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<string>;
    stashApply: (index?: number) => Promise<void>;
    stashDrop: (index?: number) => Promise<void>;
    stashList: () => Promise<string[]>;
    stashPop: (index?: number) => Promise<void>;
    stashPush: (options?: {
        message?: string;
        entries?: GitLitePathEntry[];
        paths?: string[];
        includeUntracked?: boolean;
    }) => Promise<string>;
    stashShow: (index?: number) => Promise<string>;
    status: (options?: {
        untracked?: 'all' | 'normal' | 'no';
        maxCount?: number;
    }) => Promise<{
        entries: {
            path: string;
            index: 'clean' | 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'conflicted';
            worktree: 'clean' | 'modified' | 'deleted' | 'untracked' | 'ignored' | 'conflicted';
            renamedFrom?: string;
        }[];
        truncated: boolean;
    }>;
    switch: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<void>;
    switchBranch: (name: string) => Promise<void>;
    trackingStatus: () => Promise<{
        branch?: string;
        upstream?: string;
        ahead: number;
        behind: number;
        detached: boolean;
    }>;
    tree: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<{
        has: (...petNamePath: string[]) => Promise<boolean>;
        list: (...petNamePath: string[]) => Promise<readonly string[]>;
        lookup: (petNamePath: string | readonly string[]) => Promise<unknown>;
        listTree?: (petNamePath: string | readonly string[], options?: {
            ignore?: readonly string[];
        }) => Promise<{
            path: string[];
            type: 'file' | 'directory';
        }[]>;
    }>;
    worktree: () => Promise<GitLiteDirectory & {
        entry: (path: string | string[]) => GitLitePathEntry;
    }>;
}`,
  },
  gitHistory: {
    aux: ``,
    body: `{
    cherryPick: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string, options?: {
        noCommit?: boolean;
    }) => Promise<string>;
    commit: (message: string, options?: {
        amend?: boolean;
    }) => Promise<{
        oid: string;
        summary: string;
        author?: string;
        committedAt?: number;
    }>;
    rebase: (input: {
        mode: 'start';
        upstream: string;
        autosquash?: boolean;
    } | {
        mode: 'continue' | 'abort' | 'skip';
        upstream?: never;
        autosquash?: never;
    }) => Promise<string>;
    reword: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string, message: string) => Promise<{
        oid: string;
        summary: string;
        author?: string;
        committedAt?: number;
    }>;
}`,
  },
  gitReadOnly: {
    aux: `type GitBlobRef = {
    getInfo: () => {
        algorithm: string;
        hash: string;
        size: bigint;
    };
    fetch: (offset: bigint, length: bigint) => GitERef<GitPassableBytesReader>;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
    help: (method?: string) => string;
};
type GitDirectoryEntry = {
    name: string;
    kind: 'file';
    qid: {
        type: 'file';
        pathId: bigint;
        version: bigint;
    };
} | {
    name: string;
    kind: 'directory';
    qid: {
        type: 'directory';
        pathId: bigint;
        version: bigint;
    };
};
type GitERef<T> = T | Promise<T>;
type GitExtendedDirectory = {
    getQid: () => {
        type: 'directory';
        pathId: bigint;
        version: bigint;
    };
    getStat: () => Promise<{
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    }>;
    setStat: (patch: {
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    }) => Promise<void>;
    getAttrs: () => Promise<{
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    } & {
        ctime?: bigint;
        btime?: bigint | null;
    }>;
    setAttrs: (patch: {
        size?: bigint;
        mtime?: bigint;
        atime?: bigint;
    }) => Promise<void>;
    watch: () => GitERef<{
        events: () => GitERef<GitPassableReader<GitWatchEvent>>;
        cancel: () => Promise<void>;
    }>;
    xattrs: () => GitERef<{
        get: (name: string) => GitERef<GitPassableBytesReader>;
        set: (name: string, opts?: {
            existence?: 'create' | 'replace';
        }) => GitERef<GitPassableBytesWriter>;
        list: () => GitERef<GitPassableReader<string>>;
        remove: (name: string) => Promise<void>;
        help: (method?: string) => string;
    }>;
    lookup: (nameOrPath: string | readonly string[]) => GitERef<GitExtendedDirectory | {
        getQid: () => {
            type: 'file';
            pathId: bigint;
            version: bigint;
        };
        getStat: () => Promise<{
            size?: bigint;
            mtime?: bigint;
            atime?: bigint;
        }>;
        setStat: (patch: {
            size?: bigint;
            mtime?: bigint;
            atime?: bigint;
        }) => Promise<void>;
        getAttrs: () => Promise<{
            size?: bigint;
            mtime?: bigint;
            atime?: bigint;
        } & {
            ctime?: bigint;
            btime?: bigint | null;
        }>;
        setAttrs: (patch: {
            size?: bigint;
            mtime?: bigint;
            atime?: bigint;
        }) => Promise<void>;
        watch: () => GitERef<{
            events: () => GitERef<GitPassableReader<GitWatchEvent>>;
            cancel: () => Promise<void>;
        }>;
        xattrs: () => GitERef<{
            get: (name: string) => GitERef<GitPassableBytesReader>;
            set: (name: string, opts?: {
                existence?: 'create' | 'replace';
            }) => GitERef<GitPassableBytesWriter>;
            list: () => GitERef<GitPassableReader<string>>;
            remove: (name: string) => Promise<void>;
            help: (method?: string) => string;
        }>;
        open: (opts?: {
            read?: boolean;
            write?: boolean;
            create?: boolean;
            truncate?: boolean;
            append?: boolean;
        }) => GitERef<{
            read: (offset?: bigint, length?: bigint) => GitERef<GitPassableBytesReader>;
            write: (offset?: bigint) => GitERef<GitPassableBytesWriter>;
            truncate: (size: bigint) => Promise<void>;
            fsync: () => Promise<void>;
            lock: (opts: GitLockOpts) => GitERef<GitLock>;
            getLock: (opts: {
                start?: bigint;
                length?: bigint;
            }) => Promise<GitLockState | null>;
            close: () => Promise<void>;
            help: (method?: string) => string;
        }>;
        read: (opts?: {
            offset?: bigint;
            length?: bigint;
        }) => GitERef<GitPassableBytesReader>;
        write: (opts?: {
            offset?: bigint;
        }) => GitERef<GitPassableBytesWriter>;
        snapshot: () => Promise<GitBlobRef>;
        help: (method?: string) => string;
    }>;
    lookupStep: (name: string) => GitERef<GitExtendedDirectory | {
        getQid: () => {
            type: 'file';
            pathId: bigint;
            version: bigint;
        };
        getStat: () => Promise<{
            size?: bigint;
            mtime?: bigint;
            atime?: bigint;
        }>;
        setStat: (patch: {
            size?: bigint;
            mtime?: bigint;
            atime?: bigint;
        }) => Promise<void>;
        getAttrs: () => Promise<{
            size?: bigint;
            mtime?: bigint;
            atime?: bigint;
        } & {
            ctime?: bigint;
            btime?: bigint | null;
        }>;
        setAttrs: (patch: {
            size?: bigint;
            mtime?: bigint;
            atime?: bigint;
        }) => Promise<void>;
        watch: () => GitERef<{
            events: () => GitERef<GitPassableReader<GitWatchEvent>>;
            cancel: () => Promise<void>;
        }>;
        xattrs: () => GitERef<{
            get: (name: string) => GitERef<GitPassableBytesReader>;
            set: (name: string, opts?: {
                existence?: 'create' | 'replace';
            }) => GitERef<GitPassableBytesWriter>;
            list: () => GitERef<GitPassableReader<string>>;
            remove: (name: string) => Promise<void>;
            help: (method?: string) => string;
        }>;
        open: (opts?: {
            read?: boolean;
            write?: boolean;
            create?: boolean;
            truncate?: boolean;
            append?: boolean;
        }) => GitERef<{
            read: (offset?: bigint, length?: bigint) => GitERef<GitPassableBytesReader>;
            write: (offset?: bigint) => GitERef<GitPassableBytesWriter>;
            truncate: (size: bigint) => Promise<void>;
            fsync: () => Promise<void>;
            lock: (opts: GitLockOpts) => GitERef<GitLock>;
            getLock: (opts: {
                start?: bigint;
                length?: bigint;
            }) => Promise<GitLockState | null>;
            close: () => Promise<void>;
            help: (method?: string) => string;
        }>;
        read: (opts?: {
            offset?: bigint;
            length?: bigint;
        }) => GitERef<GitPassableBytesReader>;
        write: (opts?: {
            offset?: bigint;
        }) => GitERef<GitPassableBytesWriter>;
        snapshot: () => Promise<GitBlobRef>;
        help: (method?: string) => string;
    }>;
    subView: (nameOrPath: string | readonly string[]) => GitERef<GitExtendedDirectory>;
    list: () => GitERef<{
        read: (limit?: bigint) => Promise<{
            entries: GitDirectoryEntry[];
            atEnd: boolean;
        }>;
        stream: () => GitERef<GitPassableReader<GitDirectoryEntry>>;
        toArray: () => Promise<GitDirectoryEntry[]>;
        skip: (n: bigint) => Promise<void>;
        rewind: () => Promise<void>;
        close: () => Promise<void>;
        help: (method?: string) => string;
    }>;
    write: (name: string, value: string) => Promise<void>;
    create: (name: string, opts?: {
        read?: boolean;
        write?: boolean;
        create?: boolean;
        truncate?: boolean;
        append?: boolean;
    }) => GitERef<{
        read: (offset?: bigint, length?: bigint) => GitERef<GitPassableBytesReader>;
        write: (offset?: bigint) => GitERef<GitPassableBytesWriter>;
        truncate: (size: bigint) => Promise<void>;
        fsync: () => Promise<void>;
        lock: (opts: GitLockOpts) => GitERef<GitLock>;
        getLock: (opts: {
            start?: bigint;
            length?: bigint;
        }) => Promise<GitLockState | null>;
        close: () => Promise<void>;
        help: (method?: string) => string;
    }>;
    makeDirectory: (name: string) => GitERef<GitExtendedDirectory>;
    mkdir: (name: string) => GitERef<GitExtendedDirectory>;
    remove: (name: string) => Promise<void>;
    unlink: (name: string) => Promise<void>;
    move: (fromPath: string | readonly string[], toPath: string | readonly string[]) => Promise<void>;
    copy: (fromPath: string | readonly string[], toPath: string | readonly string[]) => Promise<void>;
    rename: (oldName: string, newParent: GitERef<GitExtendedDirectory>, newName: string) => Promise<void>;
    fsync: () => Promise<void>;
    materialise: (path: readonly string[]) => GitERef<GitExtendedDirectory>;
    watchFrom: () => GitERef<{
        cursor: {
            read: (limit?: bigint) => Promise<{
                entries: GitDirectoryEntry[];
                atEnd: boolean;
            }>;
            stream: () => GitERef<GitPassableReader<GitDirectoryEntry>>;
            toArray: () => Promise<GitDirectoryEntry[]>;
            skip: (n: bigint) => Promise<void>;
            rewind: () => Promise<void>;
            close: () => Promise<void>;
            help: (method?: string) => string;
        };
        watcher: {
            events: () => GitERef<GitPassableReader<GitWatchEvent>>;
            cancel: () => Promise<void>;
        };
    }>;
    help: (method?: string) => string;
};
type GitLitePathEntry = {
    segments: () => string[];
    displayPath: () => string;
    child: (name: string) => GitLitePathEntry;
    help: (method?: string) => string;
};
type GitLock = {
    release: () => Promise<void>;
    help: (method?: string) => string;
};
type GitLockOpts = {
    type: 'shared' | 'exclusive';
    start?: bigint;
    length?: bigint;
};
type GitLockState = {
    type: 'shared' | 'exclusive';
    start: bigint;
    length: bigint;
};
type GitPassableBytesReader<TReadReturn = undefined> = {
    streamBase64: (synPromise: GitERef<GitStreamNode<unknown, TReadReturn>>) => Promise<GitStreamNode<string, TReadReturn>>;
    readReturnPattern: () => unknown | undefined;
};
type GitPassableBytesWriter<TWriteReturn = undefined> = {
    streamBase64: (synPromise: GitERef<GitStreamNode<string, TWriteReturn>>) => Promise<GitStreamNode<undefined, TWriteReturn>>;
    writeReturnPattern: () => unknown | undefined;
};
type GitPassableReader<TRead = unknown, TReadReturn = unknown> = {
    stream: (synPromise: GitERef<GitStreamNode<undefined, TReadReturn>>) => Promise<GitStreamNode<TRead, TReadReturn>>;
    readPattern: () => unknown | undefined;
    readReturnPattern: () => unknown | undefined;
};
type GitStreamNode<Y = undefined, R = undefined> = GitStreamYieldNode<Y, R> | {
    value: R;
    promise: null;
};
type GitStreamYieldNode<Y = unknown, R = undefined> = {
    value: Y;
    promise: Promise<GitStreamNode<Y, R>>;
};
type GitWatchEvent = {
    kind: 'changed' | 'created' | 'removed' | 'child-added' | 'child-removed';
    name?: string;
};`,
    body: `{
    branches: () => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    }[]>;
    currentBranch: () => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | undefined>;
    diff: (options?: {
        cached?: boolean;
        base?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        head?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        entries?: GitLitePathEntry[];
        paths?: string[];
    }) => Promise<string>;
    filesystemAt: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<{
        root: () => GitERef<GitExtendedDirectory>;
        named: (name: string) => GitERef<GitExtendedDirectory>;
        statfs: () => Promise<{
            blockSize?: bigint;
            totalBlocks?: bigint;
            freeBlocks?: bigint;
            totalBytes?: bigint;
            freeBytes?: bigint;
            files?: bigint;
            directories?: bigint;
            type?: string;
        }>;
        brands: () => Promise<ReadonlySet<bigint> | readonly bigint[]>;
        help: (method?: string) => string;
    }>;
    log: (options?: {
        maxCount?: number;
        ref?: {
            name: string;
            kind: 'branch' | 'tag' | 'commit' | 'detached';
            oid?: string;
        } | string;
        since?: string;
        until?: string;
    }) => Promise<{
        oid: string;
        summary: string;
        author?: string;
        committedAt?: number;
    }[]>;
    readOnly: () => typeof gitReadOnly;
    revParse: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<{
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    }>;
    scope: (name: 'reader') => typeof gitReadOnly;
    show: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<string>;
    stashList: () => Promise<string[]>;
    stashShow: (index?: number) => Promise<string>;
    status: (options?: {
        untracked?: 'all' | 'normal' | 'no';
        maxCount?: number;
    }) => Promise<{
        entries: {
            path: string;
            index: 'clean' | 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'conflicted';
            worktree: 'clean' | 'modified' | 'deleted' | 'untracked' | 'ignored' | 'conflicted';
            renamedFrom?: string;
        }[];
        truncated: boolean;
    }>;
    trackingStatus: () => Promise<{
        branch?: string;
        upstream?: string;
        ahead: number;
        behind: number;
        detached: boolean;
    }>;
    tree: (ref: {
        name: string;
        kind: 'branch' | 'tag' | 'commit' | 'detached';
        oid?: string;
    } | string) => Promise<{
        has: (...petNamePath: string[]) => Promise<boolean>;
        list: (...petNamePath: string[]) => Promise<readonly string[]>;
        lookup: (petNamePath: string | readonly string[]) => Promise<unknown>;
        listTree?: (petNamePath: string | readonly string[], options?: {
            ignore?: readonly string[];
        }) => Promise<{
            path: string[];
            type: 'file' | 'directory';
        }[]>;
    }>;
    worktree: () => Promise<{
        has: (...petNamePath: string[]) => Promise<boolean>;
        list: (...petNamePath: string[]) => Promise<readonly string[]>;
        lookup: (petNamePath: string | readonly string[]) => Promise<unknown>;
        listTree?: (petNamePath: string | readonly string[], options?: {
            ignore?: readonly string[];
        }) => Promise<{
            path: string[];
            type: 'file' | 'directory';
        }[]>;
    }>;
}`,
  },
});
harden(gitDeclarations);
