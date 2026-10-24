// Walks a page's exports and lists every function by dotted path with its
// tool() metadata. Tools are marked, and carry the name WebMCP has for them.

import { DEFAULT_SERVICE } from './constants';

import type { FunctionMetadata } from './tool';
import type { Manifest } from './types';

import { nameTools } from './naming';
import { isPlainObject } from './plain';
import { getFunctionMetadata, isTool } from './tool';

type CollectOptions = {
    readonly value : unknown,
    readonly path : string,
    readonly into : Record<string, FunctionMetadata>,
    readonly names : ReadonlyMap<string, string | undefined>,
};

const collect = ({ value, path, into, names } : CollectOptions) : void => {
    if (typeof value === 'function') {
        if (!isTool(value)) {
            into[path] = {};

            return;
        }

        // The name the page chose gives way to the one WebMCP has.
        const metadata = Object.fromEntries(Object.entries(getFunctionMetadata(value) ?? {})
            .filter(([ key ]) => key !== 'name'));

        const name = names.get(path);

        into[path] = {
            tool: true,
            ...name === undefined
                ? {}
                : { name },
            ...metadata
        };

        return;
    }

    if (isPlainObject(value)) {
        for (const [ key, child ] of Object.entries(value)) {
            collect({
                value: child,
                path:  path
                    ? `${ path }.${ key }`
                    : key,
                into,
                names
            });
        }
    }
};

type BuildManifestOptions = Omit<Manifest, 'functions'> & {
    readonly exports : unknown,
};

export const buildManifest = ({ exports, ...rest } : BuildManifestOptions) : Manifest => {
    const functions : Record<string, FunctionMetadata> = {};

    const names = new Map(nameTools({
        exports,
        prefix: rest.service === DEFAULT_SERVICE
            ? undefined
            : rest.service
    }).map(({ path, name, problem }) => [ path.join('.'), problem === undefined
        ? name
        : undefined ]));

    collect({ value: exports, path: '', into: functions, names });

    return { ...rest, functions };
};
