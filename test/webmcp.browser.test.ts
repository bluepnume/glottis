import { z } from 'zod';

import type { ExportsContext, Server, StandardSchema } from '../src';

import { CLIENT_TYPE, connect, describe as describeExport, serve, tool } from '../src';

import type { FakeModelContext } from './webmcp-fake';

import { delay, waitFor } from './common';
import { installFakeModelContext, removeModelContext } from './webmcp-fake';

let fake : FakeModelContext | undefined;
let server : Server<never> | undefined;
let errors : Array<string> = [];

type StartOptions = {
    readonly exports : unknown,
    readonly service ?: string,
    readonly domain ?: string | ReadonlyArray<string>,
    readonly maxBoundResults ?: number,
    readonly fakeOptions ?: Parameters<typeof installFakeModelContext>[0],
};

const start = ({ exports, service, domain, maxBoundResults, fakeOptions } : StartOptions) : FakeModelContext => {
    fake = installFakeModelContext(fakeOptions);

    server = serve({
        ...service === undefined
            ? {}
            : { service },
        clients: {
            webMcp: {
                allowed: true,
                ...domain === undefined
                    ? {}
                    : { domain },
                ...maxBoundResults === undefined
                    ? {}
                    : { maxBoundResults }
            }
        },
        exports
    });

    return fake;
};

const registered = async (names : ReadonlyArray<string>) : Promise<FakeModelContext> => {
    const current = fake;

    if (!current) {
        throw new Error('No fake installed');
    }

    await waitFor({ check: () => names.every(name => current.tools.has(name)), what: names.join(', ') });

    return current;
};

beforeEach(() => {
    errors = [];

    vi.spyOn(console, 'error').mockImplementation((...args : ReadonlyArray<unknown>) => {
        errors.push(args.map(String).join(' '));
    });
});

afterEach(() => {
    server?.stop();
    server = undefined;
    fake?.uninstall();
    fake = undefined;
    vi.restoreAllMocks();
});

const add = tool({
    description: 'Add a product to the cart',
    input:       z.object({ id: z.string(), quantity: z.number().int().min(1).default(1) }),
    annotations: { readOnlyHint: false, consequentialHint: true },
    handler:     ({ id, quantity } : { readonly id : string, readonly quantity : number }) => `${ id } x${ quantity }`
});

describe('which exports become WebMCP tools', () => {
    it('registers tool() functions by path, and leaves plain functions and constants alone', async () => {
        start({
            exports: {
                version: '1.0',
                hello:   () => 'hi',
                cart:    { add, clear: () => 'cleared' },
                lookup:  tool({ description: 'Look something up', handler: () => 'found' })
            }
        });

        const context = await registered([ 'cart_add', 'lookup' ]);

        await delay(20);
        expect(context.names()).toEqual([ 'cart_add', 'lookup' ]);
    });

    it('prefixes tools from a named service, and takes an explicit name as it is', async () => {
        start({
            service: 'checkout',
            exports: {
                cart:   { add },
                rename: tool({ name: 'pay now!', description: 'Pay', handler: () => 'paid' })
            }
        });

        await registered([ 'checkout_cart_add', 'pay_now_' ]);
    });

    it('describes each tool with its schema, annotations and description', async () => {
        const context = start({ exports: { cart: { add }, bare: tool({ handler: () => 'bare' }) } });

        await registered([ 'cart_add', 'bare' ]);

        const listed = context.tools.get('cart_add');

        expect(listed?.description).toBe('Add a product to the cart');
        expect(listed?.inputSchema).toMatchObject({ type: 'object', required: [ 'id' ] });
        expect(listed?.annotations).toEqual({ readOnlyHint: false, consequentialHint: true });
        expect(context.tools.get('bare')?.description).toBe('bare');
        expect(context.tools.get('bare')?.inputSchema).toEqual({ type: 'object', properties: {} });
        expect(context.tools.get('bare')?.annotations).toBeUndefined();
    });

    it('still accepts describe.function, the old name for tool()', async () => {
        start({ exports: { old: describeExport.function({ description: 'Old', handler: () => 'old' }) } });

        expect(await (await registered([ 'old' ])).call('old')).toBe('old');
    });
});

describe('arguments', () => {
    it('validates arguments and applies defaults', async () => {
        const context = start({ exports: { add } });

        await registered([ 'add' ]);

        expect(await context.call('add', { id: 'mug' })).toBe('mug x1');
        await expect(context.call('add', { id: 5 })).rejects.toThrow('Invalid input');
    });

    it('calls a tool with no input schema with no argument', async () => {
        const received : Array<number> = [];

        const context = start({
            exports: {
                count: tool({
                    description: 'Count arguments',

                    handler: (...args : ReadonlyArray<unknown>) => {
                        received.push(args.length);

                        return 'ok';
                    }
                })
            }
        });

        await registered([ 'count' ]);
        await context.call('count', { stray: true });

        expect(received).toEqual([ 1 ]);
    });

    it('wraps an input that is not an object as `value`', async () => {
        const search = tool({ description: 'Search', input: z.string(), handler: (query : string) => `searched ${ query }` });
        const context = start({ exports: { search } });

        await registered([ 'search' ]);

        expect(context.tools.get('search')?.inputSchema).toMatchObject({
            type:       'object',
            properties: { value: { type: 'string' } },
            required:   [ 'value' ]
        });

        expect(await context.call('search', { value: 'mugs' })).toBe('searched mugs');
        await expect(context.call('search')).rejects.toThrow('Invalid input');
    });

    it('uses an explicit JSON Schema, and refuses a validator with no JSON Schema', async () => {
        const opaque : StandardSchema<string> = {
            '~standard': { version: 1, vendor: 'test', validate: value => ({ value: String(value) }) }
        };

        const context = start({
            exports: {
                opaque:   tool({ description: 'Opaque', input: opaque, handler: (value : string) => value }),
                explicit: tool({ description: `Explicit`, input: opaque, jsonSchema: { input: { type: `object`, properties: { id: { type: `string` } } } }, handler: () => `explicit` })
            }
        });

        await registered([ 'explicit' ]);
        await delay(20);

        expect(context.tools.has('opaque')).toBe(false);

        expect(errors.join(`

        `)).toContain(`could not register WebMCP tool "opaque": its input schema cannot be turned into JSON Schema`);
    });
});

describe('results', () => {
    it('returns MCP\'s tool result, with structured content for an object', async () => {
        const context = start({
            exports: {
                object: tool({ description: 'Object', handler: () => ({ sum: 5 }) }),
                number: tool({ description: 'Number', handler: () => 5 }),
                list:   tool({ description: 'List', handler: () => [ 1, 2 ] })
            }
        });

        await registered([ 'object', 'number', 'list' ]);

        expect(await context.raw(`object`)).toEqual({ content: [ { type: `text`, text: `{"sum":5}` } ], structuredContent: { sum: 5 } });
        expect(await context.raw('number')).toEqual({ content: [ { type: 'text', text: '5' } ] });
        expect(await context.raw('list')).toEqual({ content: [ { type: 'text', text: '[1,2]' } ] });
    });

    it('reports a thrown error as an error result, message and all', async () => {
        const context = start({ exports: { add } });

        await registered([ 'add' ]);

        expect(await context.raw('add', { id: 5 })).toEqual({
            content: [ { type: 'text', text: 'Invalid input: id: Invalid input: expected string, received number' } ],
            isError: true
        });
    });

    it('sends data as JSON would', async () => {
        const when = new Date(0);

        const context = start({
            exports: {
                nothing: tool({ description: 'Nothing', handler: () => undefined }),
                data:    tool({
                    description: 'Data',

                    handler: () => ({
                        when,
                        list:    [ 1, () => 'gone', Promise.resolve(3) ],
                        plain:   () => 'dropped',
                        pending: Promise.resolve(4),
                        nested:  { kept: true, missing: undefined }
                    })
                }),
                plainFunction: tool({ description: 'A plain function', handler: () => () => 'gone' })
            }
        });

        await registered([ 'nothing', 'data', 'plainFunction' ]);

        expect(await context.call('nothing')).toBeNull();
        expect(await context.call('plainFunction')).toBeNull();
        expect(await context.call(`data`)).toEqual({ when: when.toJSON(), list: [ 1, null, null ], nested: { kept: true } });
    });

    it('fails a call whose result JSON cannot carry', async () => {
        const loop : Record<string, unknown> = {};

        loop.self = loop;

        const context = start({
            exports: {
                big:  tool({ description: 'Big', handler: () => ({ count: 10n }) }),
                loop: tool({ description: 'Loop', handler: () => loop })
            }
        });

        await registered([ 'big', 'loop' ]);

        await expect(context.call('big')).rejects.toThrow('The result of WebMCP tool "big" holds a BigInt');
        await expect(context.call('loop')).rejects.toThrow('The result of WebMCP tool "loop" refers to itself');
    });

    it('passes on errors from the function', async () => {
        const context = start({
            exports: {
                fail: tool({
                    description: 'Fail',

                    handler: () => {
                        throw new Error('out of stock');
                    }
                })
            }
        });

        await registered([ 'fail' ]);
        await expect(context.call('fail')).rejects.toThrow('out of stock');
    });
});

type Cart = { readonly items : Array<string> };

const openCart = tool({
    description: 'Open the shopping cart',

    handler: () => {
        const cart : Cart = { items: [] };

        return {
            items: cart.items,
            add:   tool({
                description: 'Add a product to this cart',
                input:       z.object({ id: z.string() }),

                handler: ({ id }) => {
                    cart.items.push(id);

                    return cart.items;
                }
            }),
            buy:       tool({ once: true, handler: () => `bought ${ cart.items.join(', ') }` }),
            rename:    tool({ name: 'addItem', description: 'Add, by another name', handler: () => 'renamed' }),
            debugDump: () => cart
        };
    }
});

describe('bound tools', () => {
    it('registers tool() functions in a result as tools bound to it', async () => {
        const context = start({ exports: { openCart } });

        await registered([ 'openCart' ]);

        expect(await context.call('openCart')).toEqual({
            items:  [],
            add:    { $tool: 'openCart_1_add' },
            buy:    { $tool: 'openCart_1_buy' },
            rename: { $tool: 'openCart_1_addItem' }
        });

        expect(context.names()).toEqual([ 'openCart', 'openCart_1_add', 'openCart_1_addItem', 'openCart_1_buy' ]);
        expect(context.tools.get(`openCart_1_add`)?.description).toBe(`From openCart (call 1): Add a product to this cart`);
        expect(context.tools.get('openCart_1_buy')?.description).toBe('From openCart (call 1): buy');

        expect(await context.call('openCart_1_add', { id: 'mug' })).toEqual([ 'mug' ]);
        expect(await context.call('openCart_1_buy')).toBe('bought mug');
        expect(context.tools.has('openCart_1_buy')).toBe(false);
    });

    it('numbers each call, never reusing a number', async () => {
        const context = start({ exports: { openCart } });

        await registered([ 'openCart' ]);
        await context.call('openCart');
        await context.call('openCart');

        expect(await context.call('openCart_2_add', { id: 'cup' })).toEqual([ 'cup' ]);
        expect(await context.call('openCart_1_add', { id: 'mug' })).toEqual([ 'mug' ]);
    });

    it('names tools in arrays by index, a returned tool by its call, and chains', async () => {
        const context = start({
            exports: {
                search: tool({
                    description: 'Search',
                    handler:     () => [ 'red', 'blue' ].map(id => ({ id, pick: tool({ description: `Pick ${ id }`, handler: () => id }) }))
                }),
                maker: tool({ description: `Make`, handler: () => tool({ description: `Made`, handler: () => ({ next: tool({ description: `Next`, handler: () => `end` }) }) }) })
            }
        });

        await registered([ 'search', 'maker' ]);

        expect(await context.call('search')).toEqual([
            { id: 'red', pick: { $tool: 'search_1_0_pick' } },
            { id: 'blue', pick: { $tool: 'search_1_1_pick' } }
        ]);

        expect(await context.call('search_1_1_pick')).toBe('blue');

        expect(await context.call('maker')).toEqual({ $tool: 'maker_1' });
        expect(await context.call('maker_1')).toEqual({ next: { $tool: 'maker_1_1_next' } });
        expect(await context.call('maker_1_1_next')).toBe('end');
    });

    it('drops a bound tool whose name would be too long', async () => {
        const context = start({
            exports: {
                [ `a`.repeat(60) ]: tool({ description: `Long`, handler: () => ({ inner: tool({ description: `Inner`, handler: () => `x` }) }) })
            }
        });

        await registered([ 'a'.repeat(60) ]);

        expect(await context.call('a'.repeat(60))).toEqual({});
        expect(errors.join('\n')).toContain('names are limited to 64 characters');
    });

    it('keeps bound tools for the most recently used results only', async () => {
        const context = start({ exports: { openCart }, maxBoundResults: 2 });

        await registered([ 'openCart' ]);
        await context.call('openCart');
        await context.call('openCart');
        await context.call('openCart_1_add', { id: 'mug' });
        await context.call('openCart');

        expect(context.tools.has('openCart_1_add')).toBe(true);
        expect(context.tools.has('openCart_2_add')).toBe(false);
        expect(context.tools.has('openCart_2_buy')).toBe(false);
        expect(context.tools.has('openCart_3_add')).toBe(true);
    });

    it('logs a bound tool the browser refuses', async () => {
        const context = start({ exports: { openCart }, fakeOptions: { reject: [ `openCart_1_rename`, `openCart_1_addItem` ] } });

        await registered([ 'openCart' ]);
        await context.call('openCart');

        expect(context.tools.has('openCart_1_addItem')).toBe(false);
        expect(errors.join('\n')).toContain('could not register WebMCP tool "openCart_1_addItem": Invalid tool name');
    });

    it('refuses a bound tool whose schema cannot become JSON Schema', async () => {
        const opaque : StandardSchema<string> = {
            '~standard': { version: 1, vendor: 'test', validate: value => ({ value: String(value) }) }
        };

        const context = start({
            exports: { outer: tool({ description: `Outer`, handler: () => ({ inner: tool({ input: opaque, handler: (value : string) => value }) }) }) }
        });

        await registered([ 'outer' ]);

        expect(await context.call('outer')).toEqual({});
        expect(errors.join('\n')).toContain('could not register WebMCP tool "outer_1_inner"');
    });
});

describe('the exports function', () => {
    it('runs once for WebMCP, with no caller and no props', async () => {
        const contexts : Array<ExportsContext> = [];

        start({
            exports: (context : ExportsContext) => {
                contexts.push(context);

                return { who: tool({ description: `Who`, handler: async () => [ context.client.type, context.props, await context.getProps() ] }) };
            }
        });

        const context = await registered([ 'who' ]);

        expect(contexts).toHaveLength(1);
        expect(await context.call('who')).toEqual([ CLIENT_TYPE.WEB_MCP, {}, {} ]);

        expect(() => {
            contexts[0]?.onProps(() => undefined).cancel();
        }).not.toThrow();
    });

    it('tells scripts on the page apart from WebMCP', async () => {
        fake = installFakeModelContext();

        server = serve({
            service: 'mixed',
            clients: { webMcp: { allowed: true } },

            exports: ({ client } : ExportsContext) => (client.type === CLIENT_TYPE.WEB_MCP
                ? { agent: tool({ description: 'For agents', handler: () => 'agent' }) }
                : { page: () => client.origin })
        });

        await registered([ 'mixed_agent' ]);

        const page = await connect<{ readonly page : () => string }>({ service: 'mixed' });

        expect(await page.exports.page()).toBe(location.origin);
        expect(fake.tools.has('mixed_page')).toBe(false);

        await page.disconnect();
    });

    it('logs an exports function that fails', async () => {
        start({
            exports: () => {
                throw new Error('not ready');
            }
        });

        await waitFor({ check: () => errors.length > 0 });
        expect(errors[0]).toContain('the exports function failed for WebMCP: not ready');
    });
});

describe('keeping tools current', () => {
    it('only re-registers tools whose definition changed, and keeps bound tools', async () => {
        let version = 1;

        const context = start({
            exports: () => ({
                stable:  tool({ description: 'Stable', handler: () => `stable ${ version }` }),
                changes: tool({ description: `Version ${ version }`, handler: () => 'changes' }),
                ...version === 1
                    ? { goes: tool({ description: 'Goes', handler: () => 'goes' }), openCart }
                    : { comes: tool({ description: 'Comes', handler: () => 'comes' }) }
            })
        });

        await registered([ 'stable', 'changes', 'goes', 'openCart' ]);
        await context.call('openCart');

        const before = context.registrations();
        const stable = context.tools.get('stable');

        version = 2;
        await server?.updateExports();

        expect(context.tools.get('stable')).toBe(stable);
        expect(await context.call('stable')).toBe('stable 2');
        expect(context.tools.get('changes')?.description).toBe('Version 2');
        expect(context.names()).toEqual([ `changes`, `comes`, `openCart_1_add`, `openCart_1_addItem`, `openCart_1_buy`, `stable` ]);
        expect(context.registrations() - before).toBe(2);
    });

    it('removes every tool on stop()', async () => {
        const context = start({ exports: { openCart } });

        await registered([ 'openCart' ]);
        await context.call('openCart');

        server?.stop();
        await server?.updateExports();

        expect(context.names()).toEqual([]);
    });

    it('registers neither of two tools with the same name', async () => {
        const context = start({
            exports: {
                cart_add: tool({ description: 'One', handler: () => 1 }),
                cart:     { add: tool({ description: 'Two', handler: () => 2 }) },
                other:    tool({ description: 'Other', handler: () => 3 })
            }
        });

        await registered([ 'other' ]);

        expect(context.tools.has('cart_add')).toBe(false);
        expect(errors.join('\n')).toContain('could not register WebMCP tool "cart_add": 2 tools have that name');
    });

    it('drops a tool whose name is too long', async () => {
        const context = start({ exports: { [ `b`.repeat(65) ]: tool({ description: `Long`, handler: () => 1 }), ok: tool({ description: `Ok`, handler: () => 1 }) } });

        await registered([ 'ok' ]);

        expect(context.names()).toEqual([ 'ok' ]);
        expect(errors.join('\n')).toContain('names are limited to 64 characters');
    });

    it('removes a once tool after its call', async () => {
        const context = start({ exports: { once: tool({ once: true, description: 'Once', handler: () => 'done' }) } });

        await registered([ 'once' ]);

        expect(await context.call('once')).toBe('done');
        expect(context.tools.has('once')).toBe(false);
    });
});

describe('who can use the tools', () => {
    it('exposes tools to the given origins', async () => {
        const context = start({ exports: { add }, domain: 'https://chatgpt.com' });

        await registered([ 'add' ]);
        expect(context.tools.get('add')?.exposedTo).toEqual([ 'https://chatgpt.com' ]);
    });

    it('takes a list of origins', async () => {
        const context = start({ exports: { add }, domain: [ 'https://chatgpt.com', 'https://claude.ai' ] });

        await registered([ 'add' ]);
        expect(context.tools.get('add')?.exposedTo).toEqual([ 'https://chatgpt.com', 'https://claude.ai' ]);
    });

    it('refuses anything but exact origins', () => {
        for (const domain of [ `*`, `chatgpt.com`, `https://chatgpt.com/`, /chatgpt/, [ `https://chatgpt.com`, `*` ], () => true ]) {
            expect(() => serve({ service: `bad`, clients: { webMcp: { allowed: true, domain: domain as string } }, exports: {} }))
                .toThrow('`clients.webMcp.domain` takes exact origins');
        }
    });
});

describe('when tools cannot be registered', () => {
    it('does nothing in a browser without WebMCP', async () => {
        const restore = removeModelContext();
        const local = serve({ service: 'no-webmcp', clients: { webMcp: { allowed: true } }, exports: { add } });

        await local.updateExports();
        local.stop();
        restore();

        expect(errors).toEqual([]);
    });

    it('stops quietly when the browser refuses tools to this frame', async () => {
        const context = start({ exports: { add, other: tool({ description: `Other`, handler: () => 1 }) }, fakeOptions: { refuse: true } });

        await delay(20);
        await server?.updateExports();

        expect(context.names()).toEqual([]);
        expect(errors).toEqual([]);
    });

    it('stops quietly when the frame is not allowed tools', async () => {
        const policy = { allowsFeature: (feature : string) => feature !== 'tools' };

        Object.defineProperty(document, 'featurePolicy', { value: policy, configurable: true });

        try {
            const context = start({ exports: { add } });

            await delay(20);
            await server?.updateExports();

            expect(context.names()).toEqual([]);
            expect(errors).toEqual([]);
        } finally {
            delete (document as { featurePolicy ?: unknown }).featurePolicy;
        }
    });

    it('logs a tool the browser rejects and registers the rest', async () => {
        const context = start({ exports: { add, other: tool({ description: `Other`, handler: () => 1 }) }, fakeOptions: { reject: [ `add` ] } });

        await registered([ 'other' ]);
        await waitFor({ check: () => errors.length > 0 });

        expect(context.tools.has('add')).toBe(false);
        expect(errors[0]).toBe('glottis: could not register WebMCP tool "add": Invalid tool name (service "default")');
    });
});

describe('the manifest', () => {
    it('marks tools and gives each the name WebMCP has for it', async () => {
        const opaque : StandardSchema<string> = {
            '~standard': { version: 1, vendor: 'test', validate: value => ({ value: String(value) }) }
        };

        const local = serve({
            service: 'named',
            exports: {
                hello:   () => 'hi',
                version: '1.0',
                cart:    { add, reset: tool({ handler: () => 'reset' }) },
                chosen:  tool({ name: 'pick me', description: 'Chosen', handler: () => 1 }),
                opaque:  tool({ input: opaque, handler: (value : string) => value }),
                long:    { [ 'c'.repeat(64) ]: tool({ handler: () => 1 }) },
                named_x: tool({ handler: () => 1 }),
                named:   { x: tool({ handler: () => 1 }) }
            }
        });

        try {
            const page = await connect({ service: 'named' });
            const { functions } = page.manifest;

            expect(functions.hello).toEqual({});
            expect(functions['cart.reset']).toEqual({ tool: true, name: 'named_cart_reset' });
            expect(functions[`cart.add`]).toMatchObject({ tool: true, name: `named_cart_add`, description: `Add a product to the cart` });
            expect(functions.chosen).toMatchObject({ tool: true, name: 'pick_me' });
            expect(functions.opaque).toEqual({ tool: true });
            expect(functions[`long.${ 'c'.repeat(64) }`]).toEqual({ tool: true });
            expect(functions.named_x).toEqual({ tool: true });
            expect(functions['named.x']).toEqual({ tool: true });

            await page.disconnect();
        } finally {
            local.stop();
        }
    });
});
