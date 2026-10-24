// The WebMCP client: offers a service's tool() functions to AI agents
// through the browser's tool API, document.modelContext. Functions made with
// tool() inside a call's result become bound tools, tied to that result.
// Experimental, like WebMCP itself: this follows the draft as it changes,
// outside semver.

import { DEFAULT_MAX_BOUND_RESULTS } from './constants';

import type { JsonSchema } from './schema';
import type { ToolAnnotations } from './tool';

import { nameTools, schemaProblem, tooLong, toSegment } from './naming';
import { isPlainObject } from './plain';
import { getFunctionMetadata, isTool } from './tool';

// AI agents using this page's tools through WebMCP: the browser's own agent
// and this page's origin always can; `domain` adds the sites embedding this
// page that may use them too.
export type WebMcpClients = {
    readonly allowed : boolean,
    // Exact origins, like 'https://chatgpt.com': WebMCP's `exposedTo` takes
    // no patterns.
    readonly domain ?: string | ReadonlyArray<string>,
    // How many call results keep their bound tools at once.
    readonly maxBoundResults ?: number,
};

// The parts of WebMCP's draft API glottis uses.
type ModelContextTool = {
    readonly name : string,
    readonly description : string,
    readonly inputSchema : JsonSchema,
    readonly annotations ?: ToolAnnotations,
    readonly execute : (args : Readonly<Record<string, unknown>> | undefined) => Promise<unknown>,
};

type ModelContext = {
    readonly registerTool : (tool : ModelContextTool, options : {
        readonly signal : AbortSignal,
        readonly exposedTo ?: ReadonlyArray<string>,
    }) => Promise<void>,
};

type FeaturePolicy = {
    readonly allowsFeature : (feature : string) => boolean,
};

const getModelContext = () : ModelContext | undefined =>
    (document as unknown as { readonly modelContext ?: ModelContext }).modelContext;

// A cross-origin frame can only register tools when its embedder grants
// allow="tools".
const toolsAllowed = () : boolean =>
    (document as unknown as { readonly featurePolicy ?: FeaturePolicy }).featurePolicy?.allowsFeature('tools') ?? true;

const NOT_ALLOWED = 'NotAllowedError';

type AnyFunction = (...args : ReadonlyArray<unknown>) => unknown;

const OBJECT_SCHEMA : JsonSchema = { type: 'object', properties: {} };

// Agents always send an object of named arguments, so a tool whose input is
// not an object takes it as `value`.
const VALUE_KEY = 'value';

type Definition = {
    readonly name : string,
    readonly description : string,
    readonly inputSchema : JsonSchema,
    readonly annotations ?: ToolAnnotations,
    readonly once : boolean,
    readonly call : (args : Readonly<Record<string, unknown>> | undefined) => Promise<unknown>,
};

type DefineOptions = {
    readonly fn : AnyFunction,
    readonly name : string,
    readonly description : string,
};

const define = ({ fn, name, description } : DefineOptions) : Definition => {
    const metadata = getFunctionMetadata(fn) ?? {};
    const schema = metadata.input;

    const problem = schemaProblem(fn);

    if (problem) {
        throw new Error(problem);
    }

    const objectInput = schema === undefined || schema.type === 'object';

    const inputSchema = schema === undefined
        ? OBJECT_SCHEMA
        : objectInput
            ? schema
            : { type: 'object', properties: { [ VALUE_KEY ]: schema }, required: [ VALUE_KEY ] };

    const call = (args : Readonly<Record<string, unknown>> | undefined) : Promise<unknown> => Promise.resolve(
        schema === undefined
            ? fn()
            : objectInput
                ? fn(args ?? {})
                : fn(args?.[VALUE_KEY])
    );

    return {
        name,
        description,
        inputSchema,
        ...metadata.annotations
            ? { annotations: metadata.annotations }
            : {},
        once: metadata.once === true,
        call
    };
};

type Entry = {
    readonly definition : Definition,
    // What an agent sees; an unchanged definition keeps its registration.
    readonly key : string,
    readonly controller : AbortController,
    call : Definition['call'],
    readonly group ?: BoundGroup,
};

type BoundGroup = {
    readonly entries : Set<Entry>,
    lastUsed : number,
};

const definitionKey = ({ name, description, inputSchema, annotations } : Definition) : string =>
    JSON.stringify({ name, description, inputSchema, annotations });

const describeError = (error : unknown) : string => (error instanceof Error
    ? error.message
    : String(error));

// Results take MCP's tool result shape, which WebMCP callers expect: the
// result as JSON text, and as structured content when it is an object.
type ToolResult = {
    readonly content : ReadonlyArray<{ readonly type : 'text', readonly text : string }>,
    readonly structuredContent ?: Readonly<Record<string, unknown>>,
    readonly isError ?: true,
};

const successResult = (value : unknown) : ToolResult => ({
    content: [ { type: 'text', text: JSON.stringify(value) } ],
    ...isPlainObject(value)
        ? { structuredContent: value }
        : {}
});

// WebMCP hides a rejected call's message from the caller, so a thrown error
// is reported in the result, as MCP does, for the agent to read and retry.
const errorResult = (error : unknown) : ToolResult => ({
    content: [ { type: 'text', text: describeError(error) } ],
    isError: true
});

// Marks where a function was dropped from a result.
const DROPPED = Symbol('dropped');

type WebMcpClient = {
    // Registers the tools in these exports, replacing the last set.
    readonly sync : (build : () => Promise<unknown>) => Promise<void>,
    readonly stop : () => void,
};

type CreateWebMcpClientOptions = {
    readonly service : string,
    // Tools from a service other than the default one are prefixed with its
    // name.
    readonly prefix : string | undefined,
    readonly options : WebMcpClients,
};

export const createWebMcpClient = ({ service, prefix, options } : CreateWebMcpClientOptions) : WebMcpClient => {
    const exposedTo = options.domain === undefined
        ? undefined
        : typeof options.domain === 'string'
            ? [ options.domain ]
            : options.domain;

    const maxBoundResults = options.maxBoundResults ?? DEFAULT_MAX_BOUND_RESULTS;

    const entries = new Map<string, Entry>();
    const groups = new Set<BoundGroup>();
    const callCounts = new Map<string, number>();

    let stopped = false;
    // Set once the browser refuses tools to this frame altogether.
    let refused = false;
    let tick = 0;
    let queue = Promise.resolve();

    const logError = (message : string) : void => {
        // eslint-disable-next-line no-console -- registration happens after serve() returns, so this is how failures are reported
        console.error(`glottis: ${ message } (service "${ service }")`);
    };

    const remove = (entry : Entry) : void => {
        entry.controller.abort();

        if (entries.get(entry.definition.name) === entry) {
            entries.delete(entry.definition.name);
        }

        entry.group?.entries.delete(entry);
    };

    const removeAll = () : void => {
        const current = [ ...entries.values() ];

        for (const entry of current) {
            remove(entry);
        }

        groups.clear();
    };

    const removeGroup = (group : BoundGroup) : void => {
        const current = [ ...group.entries ];

        for (const entry of current) {
            remove(entry);
        }

        groups.delete(group);
    };

    type RegisterOptions = {
        readonly definition : Definition,
        readonly group ?: BoundGroup,
    };

    const register = async ({ definition, group } : RegisterOptions) : Promise<void> => {
        const modelContext = getModelContext();

        if (!modelContext || stopped || refused) {
            return;
        }

        const entry : Entry = {
            definition,
            key:        definitionKey(definition),
            controller: new AbortController(),
            call:       definition.call,
            ...group
                ? { group }
                : {}
        };

        entries.set(definition.name, entry);
        group?.entries.add(entry);

        try {
            await modelContext.registerTool({
                name:        definition.name,
                description: definition.description,
                inputSchema: definition.inputSchema,
                ...definition.annotations
                    ? { annotations: definition.annotations }
                    : {},
                // eslint-disable-next-line @typescript-eslint/no-use-before-define -- execute and the result walk call each other
                execute: args => execute({ entry, args })
            }, {
                signal: entry.controller.signal,
                ...exposedTo
                    ? { exposedTo }
                    : {}
            });
        } catch (error) {
            remove(entry);

            if (error instanceof Error && error.name === NOT_ALLOWED) {
                refused = true;
                removeAll();

                return;
            }

            logError(`could not register WebMCP tool "${ definition.name }": ${ describeError(error) }`);
        }
    };

    type BindOptions = {
        readonly fn : AnyFunction,
        readonly parent : string,
        readonly path : ReadonlyArray<string>,
        readonly group : () => { readonly group : BoundGroup, readonly call : number },
        readonly pending : Array<Promise<void>>,
    };

    // A tool() function in a result: registered as a tool bound to it.
    const bind = ({ fn, parent, path, group, pending } : BindOptions) : unknown => {
        const metadata = getFunctionMetadata(fn) ?? {};
        const last = metadata.name ?? path.at(-1);
        const { group: boundGroup, call } = group();

        const name = [ parent, String(call), ...path.slice(0, -1), ...last === undefined
            ? []
            : [ last ] ].map(toSegment).join('_');

        const long = tooLong(name);

        if (long) {
            logError(`could not register WebMCP tool "${ name }": ${ long }`);

            return DROPPED;
        }

        const label = metadata.description ?? last ?? (fn.name || name);

        try {
            pending.push(register({
                definition: define({ fn, name, description: `From ${ parent } (call ${ call }): ${ label }` }),
                group:      boundGroup
            }));
        } catch (error) {
            logError(`could not register WebMCP tool "${ name }": ${ describeError(error) }`);

            return DROPPED;
        }

        return { $tool: name };
    };

    type PrepareOptions = {
        readonly value : unknown,
        readonly parent : string,
        readonly path : ReadonlyArray<string>,
        readonly ancestors : ReadonlySet<object>,
        readonly group : BindOptions['group'],
        readonly pending : Array<Promise<void>>,
    };

    // A result as JSON can carry it: tool() functions become bound tools,
    // other functions and promises are dropped, and values JSON cannot hold
    // fail the call.
    const prepare = ({ value, parent, path, ancestors, group, pending } : PrepareOptions) : unknown => {
        if (typeof value === 'function') {
            return isTool(value)
                ? bind({ fn: value as AnyFunction, parent, path, group, pending })
                : DROPPED;
        }

        if (typeof value === 'bigint') {
            throw new TypeError(`The result of WebMCP tool "${ parent }" holds a BigInt, which JSON cannot carry`);
        }

        if (typeof value !== 'object' || value === null) {
            return value;
        }

        if (typeof (value as { readonly then ?: unknown }).then === 'function') {
            return DROPPED;
        }

        if (!Array.isArray(value) && !isPlainObject(value)) {
            return value;
        }

        if (ancestors.has(value)) {
            throw new TypeError(`The result of WebMCP tool "${ parent }" refers to itself, which JSON cannot carry`);
        }

        const inner = new Set([ ...ancestors, value ]);

        type ChildOptions = { readonly child : unknown, readonly key : string };

        const prepareChild = ({ child, key } : ChildOptions) : unknown =>
            prepare({ value: child, parent, path: [ ...path, key ], ancestors: inner, group, pending });

        if (Array.isArray(value)) {
            return value.map((item : unknown, index) => {
                const prepared = prepareChild({ child: item, key: String(index) });

                return prepared === DROPPED
                    ? null
                    : prepared;
            });
        }

        const result : Record<string, unknown> = {};

        for (const [ key, child ] of Object.entries(value)) {
            const prepared = prepareChild({ child, key });

            if (prepared !== DROPPED) {
                result[key] = prepared;
            }
        }

        return result;
    };

    type ExecuteOptions = {
        readonly entry : Entry,
        readonly args : Readonly<Record<string, unknown>> | undefined,
    };

    const execute = async ({ entry, args } : ExecuteOptions) : Promise<unknown> => {
        tick += 1;

        if (entry.group) {
            entry.group.lastUsed = tick;
        }

        const parent = entry.definition.name;
        let value : unknown;

        try {
            value = await entry.call(args);
        } catch (error) {
            return errorResult(error);
        } finally {
            if (entry.definition.once) {
                remove(entry);
            }
        }

        let created : { readonly group : BoundGroup, readonly call : number } | undefined;

        // A result's bound tools share one group and one call number, made
        // when the first is found.
        const group = () : { readonly group : BoundGroup, readonly call : number } => {
            created ??= {
                group: { entries: new Set(), lastUsed: tick },
                call:  (callCounts.get(parent) ?? 0) + 1
            };

            callCounts.set(parent, created.call);

            return created;
        };

        const pending : Array<Promise<void>> = [];
        let prepared : unknown;

        try {
            prepared = prepare({ value, parent, path: [], ancestors: new Set(), group, pending });
        } catch (error) {
            return errorResult(error);
        }

        if (created) {
            groups.add(created.group);

            // The least recently used result loses its tools first.
            while (groups.size > maxBoundResults) {
                const oldest = [ ...groups ].reduce((least, candidate) => (candidate.lastUsed < least.lastUsed
                    ? candidate
                    : least));

                removeGroup(oldest);
            }
        }

        await Promise.all(pending);

        // JSON has no `undefined`; a call that returns nothing still succeeded.
        return successResult(prepared === undefined || prepared === DROPPED
            ? null
            : prepared);
    };

    const syncNow = async (build : () => Promise<unknown>) : Promise<void> => {
        if (stopped || refused || !getModelContext()) {
            return;
        }

        if (!toolsAllowed()) {
            refused = true;

            return;
        }

        let exports : unknown;

        try {
            exports = await build();
        } catch (error) {
            logError(`the exports function failed for WebMCP: ${ describeError(error) }`);

            return;
        }

        const definitions = new Map<string, Definition>();

        for (const { fn, name, problem } of nameTools({ exports, prefix })) {
            if (problem) {
                logError(`could not register WebMCP tool "${ name }": ${ problem }`);
            } else {
                definitions.set(name, define({ fn, name, description: getFunctionMetadata(fn)?.description ?? name }));
            }
        }

        // Bound tools outlive updates; only the exports' own tools change.
        const current = [ ...entries.values() ];

        for (const entry of current) {
            if (!entry.group && !definitions.has(entry.definition.name)) {
                remove(entry);
            }
        }

        const registering : Array<Promise<void>> = [];

        for (const definition of definitions.values()) {
            const existing = entries.get(definition.name);

            if (existing && !existing.group && existing.key === definitionKey(definition)) {
                existing.call = definition.call;
            } else {
                if (existing) {
                    remove(existing);
                }

                registering.push(register({ definition }));
            }
        }

        await Promise.all(registering);
    };

    return {
        sync: build => {
            queue = queue
                .then(() => syncNow(build))
                .catch((error : unknown) => {
                    logError(`could not register WebMCP tools: ${ describeError(error) }`);
                });

            return queue;
        },

        stop: () => {
            stopped = true;
            removeAll();
        }
    };
};
