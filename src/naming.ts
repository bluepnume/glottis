// The WebMCP names of the tool() functions in a service's exports. The
// manifest and the WebMCP client both read them from here, so a caller
// building its own tool list sees exactly the names WebMCP has.

import { MAX_TOOL_NAME_LENGTH } from './constants';

import { isPlainObject } from './plain';
import { getFunctionMetadata, hasInputSchema, isTool } from './tool';

type AnyFunction = (...args : ReadonlyArray<unknown>) => unknown;

type NamedTool = {
    readonly fn : AnyFunction,
    readonly path : ReadonlyArray<string>,
    readonly name : string,
    // Why it cannot be registered, when it cannot.
    readonly problem ?: string,
};

// Tool names keep to the characters MCP clients accept.
export const toSegment = (part : string) : string => part.replaceAll(/[^\w-]/g, '_');

export const tooLong = (name : string) : string | undefined => (name.length > MAX_TOOL_NAME_LENGTH
    ? `names are limited to ${ MAX_TOOL_NAME_LENGTH } characters`
    : undefined);

export const schemaProblem = (fn : AnyFunction) : string | undefined => (
    !getFunctionMetadata(fn)?.input && hasInputSchema(fn)
        ? 'its input schema cannot be turned into JSON Schema; pass `jsonSchema.input` to tool()'
        : undefined
);

type WalkOptions = {
    readonly value : unknown,
    readonly path : ReadonlyArray<string>,
    readonly prefix : string | undefined,
    readonly into : Array<NamedTool>,
};

const walk = ({ value, path, prefix, into } : WalkOptions) : void => {
    if (typeof value === 'function') {
        if (!isTool(value)) {
            return;
        }

        const explicit = getFunctionMetadata(value)?.name;

        const name = explicit === undefined
            ? [ ...prefix === undefined
                ? []
                : [ prefix ], ...path ].map(toSegment).join('_')
            : toSegment(explicit);

        const fn = value as AnyFunction;
        const problem = tooLong(name) ?? schemaProblem(fn);

        into.push({
            fn,
            path,
            name,
            ...problem === undefined
                ? {}
                : { problem }
        });

        return;
    }

    if (isPlainObject(value)) {
        for (const [ key, child ] of Object.entries(value)) {
            walk({ value: child, path: [ ...path, key ], prefix, into });
        }
    }
};

type NameToolsOptions = {
    readonly exports : unknown,
    // Tools from a service other than the default one start with its name.
    readonly prefix : string | undefined,
};

// Every tool() function in the exports, with its name; two tools with one
// name are both refused, since neither can safely claim it.
export const nameTools = ({ exports, prefix } : NameToolsOptions) : ReadonlyArray<NamedTool> => {
    const found : Array<NamedTool> = [];

    walk({ value: exports, path: [], prefix, into: found });

    const counts = new Map<string, number>();

    for (const { name } of found) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    return found.map(tool => {
        const count = counts.get(tool.name) ?? 0;

        return count > 1 && tool.problem === undefined
            ? { ...tool, problem: `${ count } tools have that name, so none of them is registered` }
            : tool;
    });
};
