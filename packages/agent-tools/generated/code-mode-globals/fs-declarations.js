// @ts-check
/// <reference types="ses"/>

/**
 * GENERATED FILE - do not edit by hand.
 *
 * Regenerate with: yarn workspace @endo/agent-tools gen:code-mode-types
 *
 * Source of truth:
 *   - workspace: packages/daemon/src/types.d.ts (the `EndoMount` interface),
 *     reached through the re-export in
 *     packages/agent-tools/src/code-mode-globals/daemon-mount-types.ts and
 *     printed by the TypeScript compiler API.
 *   - filesystem: packages/platform/src/fs/extended/types.ts (the local
 *     `Filesystem` type alias and the capability types it reaches), printed
 *     by the TypeScript compiler API.
 *
 * The generic extraction and rendering live in
 * scripts/code-mode-type-extract.js; this exo's source configuration lives in
 * its scripts/code-mode-*-extract.js extractor. The divergence gate in
 * test/code-mode-types.test.js keeps this artifact fresh.
 *
 * Each entry is consumed by formatGlobalDeclarations in code-mode/declarations.js via
 * the per-exo descriptor in code-mode-globals/fs.js:
 * `aux` is the supporting `type` aliases, `body` is the object type spliced
 * after the dynamic `declare const <name>:`.
 */

export const fsDeclarations = harden({
  filesystem: {
    aux: `type Directory = {
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
    watch: () => ERef<{
        events: () => ERef<{
            stream: (synPromise: ERef<StreamNode<undefined, unknown>>) => Promise<StreamNode<{
                kind: 'changed' | 'created' | 'removed' | 'child-added' | 'child-removed';
                name?: string;
            }, unknown>>;
            readPattern: () => unknown | undefined;
            readReturnPattern: () => unknown | undefined;
        }>;
        cancel: () => Promise<void>;
    }>;
    xattrs: () => ERef<{
        get: (name: string) => ERef<PassableBytesReader>;
        set: (name: string, opts?: {
            existence?: 'create' | 'replace';
        }) => ERef<PassableBytesWriter>;
        list: () => ERef<{
            stream: (synPromise: ERef<StreamNode<undefined, unknown>>) => Promise<StreamNode<string, unknown>>;
            readPattern: () => unknown | undefined;
            readReturnPattern: () => unknown | undefined;
        }>;
        remove: (name: string) => Promise<void>;
        help: (method?: string) => string;
    }>;
    lookup: (nameOrPath: string | readonly string[]) => ERef<Directory | File>;
    lookupStep: (name: string) => ERef<Directory | File>;
    subView: (nameOrPath: string | readonly string[]) => ERef<Directory>;
    list: () => ERef<{
        read: (limit?: bigint) => Promise<{
            entries: DirectoryEntry[];
            atEnd: boolean;
        }>;
        stream: () => ERef<{
            stream: (synPromise: ERef<StreamNode<undefined, unknown>>) => Promise<StreamNode<DirectoryEntry, unknown>>;
            readPattern: () => unknown | undefined;
            readReturnPattern: () => unknown | undefined;
        }>;
        toArray: () => Promise<DirectoryEntry[]>;
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
    }) => ERef<{
        read: (offset?: bigint, length?: bigint) => ERef<PassableBytesReader>;
        write: (offset?: bigint) => ERef<PassableBytesWriter>;
        truncate: (size: bigint) => Promise<void>;
        fsync: () => Promise<void>;
        lock: (opts: LockOpts) => ERef<Lock>;
        getLock: (opts: {
            start?: bigint;
            length?: bigint;
        }) => Promise<{
            type: 'shared' | 'exclusive';
            start: bigint;
            length: bigint;
        } | null>;
        close: () => Promise<void>;
        help: (method?: string) => string;
    }>;
    makeDirectory: (name: string) => ERef<Directory>;
    mkdir: (name: string) => ERef<Directory>;
    remove: (name: string) => Promise<void>;
    unlink: (name: string) => Promise<void>;
    move: (fromPath: string | readonly string[], toPath: string | readonly string[]) => Promise<void>;
    copy: (fromPath: string | readonly string[], toPath: string | readonly string[]) => Promise<void>;
    rename: (oldName: string, newParent: ERef<Directory>, newName: string) => Promise<void>;
    fsync: () => Promise<void>;
    materialise: (path: readonly string[]) => ERef<Directory>;
    watchFrom: () => ERef<{
        cursor: {
            read: (limit?: bigint) => Promise<{
                entries: DirectoryEntry[];
                atEnd: boolean;
            }>;
            stream: () => ERef<{
                stream: (synPromise: ERef<StreamNode<undefined, unknown>>) => Promise<StreamNode<DirectoryEntry, unknown>>;
                readPattern: () => unknown | undefined;
                readReturnPattern: () => unknown | undefined;
            }>;
            toArray: () => Promise<DirectoryEntry[]>;
            skip: (n: bigint) => Promise<void>;
            rewind: () => Promise<void>;
            close: () => Promise<void>;
            help: (method?: string) => string;
        };
        watcher: {
            events: () => ERef<{
                stream: (synPromise: ERef<StreamNode<undefined, unknown>>) => Promise<StreamNode<{
                    kind: 'changed' | 'created' | 'removed' | 'child-added' | 'child-removed';
                    name?: string;
                }, unknown>>;
                readPattern: () => unknown | undefined;
                readReturnPattern: () => unknown | undefined;
            }>;
            cancel: () => Promise<void>;
        };
    }>;
    help: (method?: string) => string;
};
type DirectoryEntry = {
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
type ERef<T> = T | Promise<T>;
type File = {
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
    watch: () => ERef<{
        events: () => ERef<{
            stream: (synPromise: ERef<StreamNode<undefined, unknown>>) => Promise<StreamNode<{
                kind: 'changed' | 'created' | 'removed' | 'child-added' | 'child-removed';
                name?: string;
            }, unknown>>;
            readPattern: () => unknown | undefined;
            readReturnPattern: () => unknown | undefined;
        }>;
        cancel: () => Promise<void>;
    }>;
    xattrs: () => ERef<{
        get: (name: string) => ERef<PassableBytesReader>;
        set: (name: string, opts?: {
            existence?: 'create' | 'replace';
        }) => ERef<PassableBytesWriter>;
        list: () => ERef<{
            stream: (synPromise: ERef<StreamNode<undefined, unknown>>) => Promise<StreamNode<string, unknown>>;
            readPattern: () => unknown | undefined;
            readReturnPattern: () => unknown | undefined;
        }>;
        remove: (name: string) => Promise<void>;
        help: (method?: string) => string;
    }>;
    open: (opts?: {
        read?: boolean;
        write?: boolean;
        create?: boolean;
        truncate?: boolean;
        append?: boolean;
    }) => ERef<{
        read: (offset?: bigint, length?: bigint) => ERef<PassableBytesReader>;
        write: (offset?: bigint) => ERef<PassableBytesWriter>;
        truncate: (size: bigint) => Promise<void>;
        fsync: () => Promise<void>;
        lock: (opts: LockOpts) => ERef<Lock>;
        getLock: (opts: {
            start?: bigint;
            length?: bigint;
        }) => Promise<{
            type: 'shared' | 'exclusive';
            start: bigint;
            length: bigint;
        } | null>;
        close: () => Promise<void>;
        help: (method?: string) => string;
    }>;
    read: (opts?: {
        offset?: bigint;
        length?: bigint;
    }) => ERef<PassableBytesReader>;
    write: (opts?: {
        offset?: bigint;
    }) => ERef<PassableBytesWriter>;
    snapshot: () => Promise<{
        getInfo: () => {
            algorithm: string;
            hash: string;
            size: bigint;
        };
        fetch: (offset: bigint, length: bigint) => ERef<PassableBytesReader>;
        text: () => Promise<string>;
        json: () => Promise<unknown>;
        help: (method?: string) => string;
    }>;
    help: (method?: string) => string;
};
type Lock = {
    release: () => Promise<void>;
    help: (method?: string) => string;
};
type LockOpts = {
    type: 'shared' | 'exclusive';
    start?: bigint;
    length?: bigint;
};
type PassableBytesReader<TReadReturn = undefined> = {
    streamBase64: (synPromise: ERef<StreamNode<unknown, TReadReturn>>) => Promise<StreamNode<string, TReadReturn>>;
    readReturnPattern: () => unknown | undefined;
};
type PassableBytesWriter<TWriteReturn = undefined> = {
    streamBase64: (synPromise: ERef<StreamNode<string, TWriteReturn>>) => Promise<StreamNode<undefined, TWriteReturn>>;
    writeReturnPattern: () => unknown | undefined;
};
type StreamNode<Y = undefined, R = undefined> = StreamYieldNode<Y, R> | {
    value: R;
    promise: null;
};
type StreamYieldNode<Y = unknown, R = undefined> = {
    value: Y;
    promise: Promise<StreamNode<Y, R>>;
};`,
    body: `{
    brands: () => Promise<ReadonlySet<bigint> | readonly bigint[]>;
    help: (method?: string) => string;
    named: (name: string) => ERef<Directory>;
    root: () => ERef<Directory>;
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
}`,
  },
  workspace: {
    aux: `type MountERef<T> = T | Promise<T>;
type MountPathEntry = {
    segments: () => string[];
    displayPath: () => string;
    child: (name: string) => MountPathEntry;
    help: (method?: string) => string;
};
type MountReadableTreeView = {
    has: (...pathSegments: string[]) => Promise<boolean>;
    list: (...pathSegments: string[]) => Promise<readonly string[]>;
    listTree: (petNamePath: string | readonly string[], options?: {
        ignore?: readonly string[];
    }) => Promise<{
        path: string[];
        type: 'file' | 'directory';
    }[]>;
    lookup: (path: string | readonly string[]) => Promise<MountReadableTreeView | {
        streamBase64: (synPromise: MountERef<MountStreamNode<unknown, unknown>>) => Promise<MountStreamNode<string, undefined>>;
        text: () => Promise<string>;
        json: () => Promise<unknown>;
        getInfo: () => Promise<{
            algorithm: string;
            hash: string;
            size: bigint;
        }>;
        fetch: (offset: bigint, length: bigint) => Promise<{
            streamBase64: (synPromise: MountERef<MountStreamNode<unknown, undefined>>) => Promise<MountStreamNode<string, undefined>>;
            readReturnPattern: () => unknown | undefined;
        }>;
        help: (method?: string) => string;
    }>;
    help: (method?: string) => string;
};
type MountStreamNode<Y = undefined, R = undefined> = MountStreamYieldNode<Y, R> | {
    value: R;
    promise: null;
};
type MountStreamYieldNode<Y = unknown, R = undefined> = {
    value: Y;
    promise: Promise<MountStreamNode<Y, R>>;
};`,
    body: `{
    copy: (from: string | string[] | MountPathEntry, to: string | string[] | MountPathEntry) => Promise<void>;
    entry: (path: string | string[]) => MountPathEntry;
    followNameChanges: (...pathSegments: string[]) => {
        stream: (synPromise: MountERef<MountStreamNode<undefined, undefined>>) => Promise<MountStreamNode<{
            add: string;
            type: 'file' | 'directory';
        } | {
            remove: string;
        }, undefined>>;
        readPattern: () => unknown | undefined;
        readReturnPattern: () => unknown | undefined;
    };
    glob: (pattern: string) => Promise<string[]>;
    glorp: (globPattern: string, grepPattern: string, options?: {
        maxResults?: number;
    }) => Promise<Array<{
        file: string;
        line: number;
        text: string;
    }>>;
    grep: (pattern: string, paths?: string[] | Promise<string[]>, options?: {
        maxResults?: number;
    }) => Promise<Array<{
        file: string;
        line: number;
        text: string;
    }>>;
    has: {
        (...pathSegments: string[]): Promise<boolean>;
        (entry: MountPathEntry): Promise<boolean>;
    };
    help: (method?: string) => string;
    kind: () => 'directory';
    list: (...pathSegments: string[]) => Promise<string[]>;
    lookup: (path: string | readonly string[] | MountPathEntry) => Promise<typeof workspace | {
        kind: () => 'file';
        list: () => Promise<never>;
        text: () => Promise<string>;
        streamBase64: (synPromise: MountERef<MountStreamNode<unknown, unknown>>) => Promise<MountStreamNode<string, undefined>>;
        json: () => Promise<unknown>;
        getInfo: () => Promise<{
            algorithm: string;
            hash: string;
            size: bigint;
        }>;
        fetch: (offset: bigint, length: bigint) => Promise<{
            streamBase64: (synPromise: MountERef<MountStreamNode<unknown, undefined>>) => Promise<MountStreamNode<string, undefined>>;
            readReturnPattern: () => unknown | undefined;
        }>;
        writeText: (content: string) => Promise<void>;
        append: (content: string) => Promise<void>;
        writeBytes: (readableRef: MountERef<{
            streamBase64: (synPromise: MountERef<MountStreamNode<unknown, undefined>>) => Promise<MountStreamNode<string, undefined>>;
            readReturnPattern: () => unknown | undefined;
        }>) => Promise<void>;
        stat: () => Promise<{
            kind: 'file' | 'directory' | 'symlink';
            size: bigint;
            mtime: bigint;
            atime: bigint;
        }>;
        snapshot: () => Promise<unknown>;
        readOnly: () => {
            streamBase64: (synPromise: MountERef<MountStreamNode<unknown, unknown>>) => Promise<MountStreamNode<string, undefined>>;
            text: () => Promise<string>;
            json: () => Promise<unknown>;
            getInfo: () => Promise<{
                algorithm: string;
                hash: string;
                size: bigint;
            }>;
            fetch: (offset: bigint, length: bigint) => Promise<{
                streamBase64: (synPromise: MountERef<MountStreamNode<unknown, undefined>>) => Promise<MountStreamNode<string, undefined>>;
                readReturnPattern: () => unknown | undefined;
            }>;
            help: (method?: string) => string;
        };
        help: (method?: string) => string;
    }>;
    makeDirectory: (path: string | string[] | MountPathEntry) => Promise<typeof workspace>;
    makeFile: (path: string | string[] | MountPathEntry, content?: string) => Promise<void>;
    maybeLookup: (path: string | string[] | MountPathEntry) => Promise<typeof workspace | {
        kind: () => 'file';
        list: () => Promise<never>;
        text: () => Promise<string>;
        streamBase64: (synPromise: MountERef<MountStreamNode<unknown, unknown>>) => Promise<MountStreamNode<string, undefined>>;
        json: () => Promise<unknown>;
        getInfo: () => Promise<{
            algorithm: string;
            hash: string;
            size: bigint;
        }>;
        fetch: (offset: bigint, length: bigint) => Promise<{
            streamBase64: (synPromise: MountERef<MountStreamNode<unknown, undefined>>) => Promise<MountStreamNode<string, undefined>>;
            readReturnPattern: () => unknown | undefined;
        }>;
        writeText: (content: string) => Promise<void>;
        append: (content: string) => Promise<void>;
        writeBytes: (readableRef: MountERef<{
            streamBase64: (synPromise: MountERef<MountStreamNode<unknown, undefined>>) => Promise<MountStreamNode<string, undefined>>;
            readReturnPattern: () => unknown | undefined;
        }>) => Promise<void>;
        stat: () => Promise<{
            kind: 'file' | 'directory' | 'symlink';
            size: bigint;
            mtime: bigint;
            atime: bigint;
        }>;
        snapshot: () => Promise<unknown>;
        readOnly: () => {
            streamBase64: (synPromise: MountERef<MountStreamNode<unknown, unknown>>) => Promise<MountStreamNode<string, undefined>>;
            text: () => Promise<string>;
            json: () => Promise<unknown>;
            getInfo: () => Promise<{
                algorithm: string;
                hash: string;
                size: bigint;
            }>;
            fetch: (offset: bigint, length: bigint) => Promise<{
                streamBase64: (synPromise: MountERef<MountStreamNode<unknown, undefined>>) => Promise<MountStreamNode<string, undefined>>;
                readReturnPattern: () => unknown | undefined;
            }>;
            help: (method?: string) => string;
        };
        help: (method?: string) => string;
    } | undefined>;
    maybeReadText: (path: string | string[] | MountPathEntry) => Promise<string | undefined>;
    move: (from: string | string[] | MountPathEntry, to: string | string[] | MountPathEntry) => Promise<void>;
    readOnly: () => MountReadableTreeView;
    readText: (path: string | string[] | MountPathEntry) => Promise<string>;
    remove: (path: string | string[] | MountPathEntry) => Promise<void>;
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
    stat: (path: string | string[] | MountPathEntry) => Promise<{
        kind: 'file' | 'directory' | 'symlink';
        size: bigint;
        mtime: bigint;
        atime: bigint;
    } | undefined>;
    subView: (path: string | string[] | MountPathEntry) => Promise<typeof workspace>;
    write: (path: string | string[] | MountPathEntry, value: {
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
    writeText: (path: string | string[] | MountPathEntry, content: string) => Promise<void>;
}`,
  },
});
harden(fsDeclarations);
