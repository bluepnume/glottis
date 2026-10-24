// Walks a page's exports and lists every function by dotted path with its
// describe.function metadata.

import type { FunctionMetadata } from './describe';
import type { Manifest } from './types';

import { getFunctionMetadata } from './describe';

export const isPlainObject = (value : unknown) : value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const proto : unknown = Object.getPrototypeOf(value);

    return proto === Object.prototype || proto === null;
};

type CollectOptions = {
    readonly value : unknown,
    readonly path : string,
    readonly into : Record<string, FunctionMetadata>,
};

const collect = ({ value, path, into } : CollectOptions) : void => {
    if (typeof value === 'function') {
        into[path] = getFunctionMetadata(value) ?? {};

        return;
    }

    if (isPlainObject(value)) {
        for (const [ key, child ] of Object.entries(value)) {
            collect({
                value: child,
                path:  path
                    ? `${ path }.${ key }`
                    : key,
                into
            });
        }
    }
};

type BuildManifestOptions = Omit<Manifest, 'functions'> & {
    readonly exports : unknown,
};

export const buildManifest = ({ exports, ...rest } : BuildManifestOptions) : Manifest => {
    const functions : Record<string, FunctionMetadata> = {};

    collect({ value: exports, path: '', into: functions });

    return { ...rest, functions };
};
