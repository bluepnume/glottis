// A stand-in for WebMCP's document.modelContext, following the draft spec:
// registerTool resolves once the tool is listed, rejects a duplicate name,
// and the tool goes when its signal aborts.

type Args = Readonly<Record<string, unknown>> | undefined;

export type FakeTool = {
    readonly name : string,
    readonly description : string,
    readonly inputSchema : Readonly<Record<string, unknown>>,
    readonly annotations ?: Readonly<Record<string, unknown>>,
    readonly execute : (args : Args) => Promise<unknown>,
    readonly exposedTo ?: ReadonlyArray<string>,
};

type RegisterOptions = {
    readonly signal ?: AbortSignal,
    readonly exposedTo ?: ReadonlyArray<string>,
};

export type FakeModelContext = {
    readonly tools : Map<string, FakeTool>,
    readonly names : () => ReadonlyArray<string>,
    // Runs a tool and reads its MCP-shaped result: the value from its JSON
    // text, or a thrown error for an error result.
    readonly call : (name : string, args ?: Args) => Promise<unknown>,
    // Runs a tool and returns its result as the browser gets it.
    readonly raw : (name : string, args ?: Args) => Promise<unknown>,
    readonly registrations : () => number,
    readonly uninstall : () => void,
};

type Holder = { modelContext ?: unknown };

type ToolResult = {
    readonly content : ReadonlyArray<{ readonly text : string }>,
    readonly isError ?: boolean,
};

type InstallFakeModelContextOptions = {
    // Every registration is refused, as in a frame without allow="tools".
    readonly refuse ?: boolean,
    // These names are rejected with an error.
    readonly reject ?: ReadonlyArray<string>,
};

export const installFakeModelContext = (options : InstallFakeModelContextOptions = {}) : FakeModelContext => {
    const { refuse = false, reject = [] } = options;
    const tools = new Map<string, FakeTool>();
    let registrations = 0;

    const fake = {
        // eslint-disable-next-line @typescript-eslint/require-await -- the real one is async
        registerTool: async (tool : FakeTool, { signal, exposedTo } : RegisterOptions = {}) : Promise<void> => {
            if (refuse) {
                throw new DOMException(`Access to the feature "tools" is disallowed by permissions policy.`, `NotAllowedError`);
            }

            if (reject.includes(tool.name)) {
                throw new DOMException('Invalid tool name', 'InvalidStateError');
            }

            if (signal?.aborted) {
                throw new DOMException('signal is aborted without reason', 'AbortError');
            }

            if (tools.has(tool.name)) {
                throw new DOMException('Duplicate tool name', 'InvalidStateError');
            }

            const listed = {
                ...tool,
                ...exposedTo
                    ? { exposedTo }
                    : {}
            };

            tools.set(tool.name, listed);
            registrations += 1;

            signal?.addEventListener('abort', () => {
                if (tools.get(tool.name) === listed) {
                    tools.delete(tool.name);
                }
            });
        }
    };

    Object.defineProperty(document, 'modelContext', { value: fake, configurable: true });

    const raw = async (name : string, args ?: Args) : Promise<unknown> => {
        const tool = tools.get(name);

        if (!tool) {
            throw new Error(`No tool named ${ name }`);
        }

        return await tool.execute(args ?? {});
    };

    return {
        tools,
        names:         () => [ ...tools.keys() ].toSorted(),
        registrations: () => registrations,

        raw,

        call: async (name, args) => {
            const result = await raw(name, args) as ToolResult;
            const text = result.content[0]?.text ?? '';

            if (result.isError) {
                throw new Error(text);
            }

            return JSON.parse(text) as unknown;
        },

        uninstall: () => {
            delete (document as Holder).modelContext;
        }
    };
};

// A browser with no WebMCP at all.
export const removeModelContext = () : (() => void) => {
    Object.defineProperty(document, 'modelContext', { value: undefined, configurable: true });

    return () => {
        delete (document as Holder).modelContext;
    };
};
