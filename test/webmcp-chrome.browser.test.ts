// The WebMCP client against Chrome's own draft implementation, turned on
// with --enable-features=WebMCP (vitest.config.ts). This is the suite that
// fails when the draft changes under us.

import { z } from 'zod';

import type { Server } from '../src';

import { connect, serve, tool } from '../src';

import { cleanFrames, pageUrl, waitFor } from './common';

type RegisteredTool = {
    readonly name : string,
    readonly description : string,
    readonly inputSchema ?: string,
};

type ModelContext = EventTarget & {
    readonly getTools : () => Promise<ReadonlyArray<RegisteredTool>>,
    readonly executeTool : (tool : RegisteredTool, args : Readonly<Record<string, unknown>>) => Promise<string>,
};

const modelContext = () : ModelContext => {
    const found = (document as unknown as { readonly modelContext ?: ModelContext }).modelContext;

    if (!found) {
        throw new Error('This Chromium has no document.modelContext; run it with --enable-features=WebMCP');
    }

    return found;
};

const names = async () : Promise<ReadonlyArray<string>> =>
    (await modelContext().getTools()).map(({ name }) => name).toSorted();

const listed = async (name : string) : Promise<RegisteredTool> => {
    let found : RegisteredTool | undefined;

    await waitFor({
        check: () => {
            void modelContext().getTools().then(tools => {
                found = tools.find(candidate => candidate.name === name);
            });

            return found !== undefined;
        },

        what: `tool ${ name }`
    });

    if (!found) {
        throw new Error(`No tool ${ name }`);
    }

    return found;
};

type RunOptions = { readonly name : string, readonly args ?: Readonly<Record<string, unknown>> };

const run = async ({ name, args = {} } : RunOptions) : Promise<string> =>
    await modelContext().executeTool(await listed(name), args);

let server : Server<never> | undefined;

afterEach(() => {
    server?.stop();
    server = undefined;
    cleanFrames();
});

describe('WebMCP in Chrome', () => {
    it('registers tool() functions, and runs them with checked arguments', async () => {
        server = serve({
            service: 'chrome',
            clients: { webMcp: { allowed: true } },
            exports: {
                add: tool({
                    description: 'Add two numbers',
                    input:       z.object({ a: z.number(), b: z.number() }),
                    annotations: { readOnlyHint: true },
                    handler:     ({ a, b } : { readonly a : number, readonly b : number }) => ({ sum: a + b })
                }),
                nothing: tool({ description: 'Return nothing', handler: () => undefined })
            }
        });

        const add = await listed('chrome_add');

        expect(add.description).toBe('Add two numbers');
        expect(JSON.parse(await run({ name: 'chrome_add', args: { a: 2, b: 3 } }))).toEqual({ sum: 5 });
        expect(await run({ name: 'chrome_nothing' })).toBe('null');

        // Chrome reports a failed tool without its message.
        await expect(run({ name: 'chrome_add', args: { a: 'two' } })).rejects.toThrow('invocation failed');
    });

    it('registers bound tools and tells agents the list changed', async () => {
        let changes = 0;

        const onChange = () : void => {
            changes += 1;
        };

        modelContext().addEventListener('toolchange', onChange);

        server = serve({
            service: 'bound',
            clients: { webMcp: { allowed: true } },
            exports: {
                open: tool({
                    description: 'Open a counter',

                    handler: () => {
                        let count = 0;

                        return {
                            increment: tool({
                                description: 'Count one more',

                                handler: () => {
                                    count += 1;

                                    return count;
                                }
                            })
                        };
                    }
                })
            }
        });

        await listed('bound_open');
        const before = changes;

        expect(JSON.parse(await run({ name: `bound_open` }))).toEqual({ increment: { $tool: `bound_open_1_increment` } });
        expect(await run({ name: 'bound_open_1_increment' })).toBe('1');
        expect(changes).toBeGreaterThan(before);

        server.stop();
        await waitFor({ check: () => changes > before + 1, what: 'the tools to go' });

        expect((await names()).filter(name => name.startsWith('bound_'))).toEqual([]);

        modelContext().removeEventListener('toolchange', onChange);
    });

    it('registers nothing, and logs nothing, in a frame without allow="tools"', async () => {
        type Frame = { readonly logged : () => ReadonlyArray<string>, readonly tools : () => ReadonlyArray<string> };

        const frame = await connect<Frame>({
            url: pageUrl({ scenario: 'webMcp' })
        });

        await new Promise(resolve => {
            setTimeout(resolve, 200);
        });

        expect(await frame.exports.tools()).toEqual([]);
        expect(await frame.exports.logged()).toEqual([]);

        await frame.disconnect();
    });

    it('registers tools in a cross-origin frame its top-level page grants allow="tools"', async () => {
        type Report = { readonly tools : ReadonlyArray<string>, readonly logged : ReadonlyArray<string> };

        const host = await connect<{ readonly granted : () => Report, readonly refused : () => Report }>({
            url:    pageUrl({ scenario: 'webMcpHost' }),
            target: { type: 'popup' }
        });

        let granted : Report = { tools: [], logged: [] };

        await waitFor({
            check: () => {
                void host.exports.granted().then(report => {
                    granted = report;
                });

                return granted.tools.includes('greet');
            },

            what: 'the granted frame to register greet'
        });

        expect(granted.logged).toEqual([]);
        expect(await host.exports.refused()).toEqual({ tools: [], logged: [] });

        await host.disconnect();
    });
});
