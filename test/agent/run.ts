// Real-agent tests: a Claude agent (through the Claude Agent SDK, signed in
// as you) uses a glottis page's WebMCP tools in real Chrome, and each
// scenario checks what it actually did to the page.
//
// The shop (shop.ts) serves from a cross-origin frame with allow="tools";
// the top page lists its tools with getTools({ fromOrigins }) and runs them
// with executeTool, as an embedding agent would. The tools reach the agent
// as an MCP server whose list follows the page's: bound tools appear as
// results create them, with notifications/tools/list_changed.
//
//     npm run test:agent
//     npm run test:agent -- --scenario bound-cart --runs 3 --model claude-sonnet-5-5
//
// Not part of npm test: it is slow, costs tokens, and an agent's choices
// vary from run to run.

import type { AddressInfo } from 'node:net';
import type { Frame, Page } from 'playwright';

import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { chromium } from 'playwright';

import { query } from '@anthropic-ai/claude-agent-sdk';
// eslint-disable-next-line import/no-unresolved -- resolved through the package's exports map
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// eslint-disable-next-line import/no-unresolved -- resolved through the package's exports map
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const root = path.resolve(import.meta.dirname, '../..');

const say = (line : string) : void => {
    process.stdout.write(`${ line }\n`);
};

type Line = { readonly sku : string, readonly quantity : number };

type ShopState = {
    readonly carts : ReadonlyArray<ReadonlyArray<Line>>,
    readonly orders : ReadonlyArray<{ readonly id : number, readonly lines : ReadonlyArray<Line> }>,
    readonly wishlist : ReadonlyArray<string>,
    readonly delivery ?: string,
    readonly signedIn ?: string,
};

type ToolCall = {
    readonly name : string,
    readonly args : unknown,
    readonly isError : boolean,
    readonly text : string,
};

type Outcome = {
    readonly state : ShopState,
    readonly calls : ReadonlyArray<ToolCall>,
    readonly answer : string,
};

type Scenario = {
    readonly name : string,
    readonly what : string,
    readonly prompt : string,
    // What went wrong, if anything.
    readonly check : (outcome : Outcome) => ReadonlyArray<string>,
};

const lines = (order : ShopState['orders'][number] | undefined) : string =>
    JSON.stringify([ ...order?.lines ?? [] ].map(({ sku, quantity }) => `${ sku } x${ quantity }`).toSorted());

const SCENARIOS : ReadonlyArray<Scenario> = [
    {
        name:   'bound-cart',
        what:   'Calls tools that a result created, and tools that their results created in turn',
        prompt: 'Buy two red mugs and one blue cup, then tell me the delivery status of the order.',

        check: ({ state, answer }) => [
            ...state.orders.length === 1
                ? []
                : [ `expected 1 order, got ${ state.orders.length }` ],
            ...lines(state.orders[0]) === '["blue-cup x1","red-mug x2"]'
                ? []
                : [ `expected red-mug x2 and blue-cup x1, got ${ lines(state.orders[0]) }` ],
            ...answer.toLowerCase().includes('courier')
                ? []
                : [ 'the answer does not give the tracking status (awaiting courier pickup)' ]
        ]
    },
    {
        name:   'two-carts',
        what:   'Keeps two results’ bound tools apart (openCart_1_* and openCart_2_*)',
        prompt: `Open two separate carts. Put a red mug in the first and a tea towel in the second. Then check out only the second cart.`,

        check: ({ state }) => [
            ...state.carts.length === 2
                ? []
                : [ `expected 2 carts, got ${ state.carts.length }` ],
            ...JSON.stringify(state.carts[0]) === '[{"sku":"red-mug","quantity":1}]'
                ? []
                : [ `expected the first cart to hold one red mug, got ${ JSON.stringify(state.carts[0]) }` ],
            ...state.orders.length === 1 && lines(state.orders[0]) === '["tea-towel x1"]'
                ? []
                : [ `expected one order of a tea towel, got ${ JSON.stringify(state.orders.map(lines)) }` ]
        ]
    },
    {
        name:   'array-results',
        what:   'Picks the right item from an array of results, each with its own bound tool',
        prompt: 'Search the shop for mugs and add the cheapest one to my wishlist.',

        check: ({ state }) => (JSON.stringify(state.wishlist) === '["green-mug"]'
            ? []
            : [ `expected the wishlist to be ["green-mug"], got ${ JSON.stringify(state.wishlist) }` ])
    },
    {
        name:   'exports-update',
        what:   'Notices a tool that appears after another tool calls updateExports()',
        prompt: 'Sign in as sam@example.com, then tell me how many past orders I have.',

        check: ({ state, calls, answer }) => [
            ...state.signedIn === 'sam@example.com'
                ? []
                : [ `expected to be signed in as sam@example.com, got ${ String(state.signedIn) }` ],
            ...calls.some(call => call.name === 'orderHistory')
                ? []
                : [ 'the agent never called orderHistory, which only appears after signing in' ],
            ...(/\b(3|three)\b/i).test(answer)
                ? []
                : [ 'the answer does not say there are 3 past orders' ]
        ]
    },
    {
        name:   'error-recovery',
        what:   'Reads an error result’s message (a rule its schema cannot express) and corrects itself',
        prompt: `Schedule delivery for Saturday 2026-10-31. If that day is not possible, use the earliest possible day after it.`,

        check: ({ state, calls }) => [
            ...state.delivery === '2026-11-02'
                ? []
                : [ `expected delivery on 2026-11-02, got ${ String(state.delivery) }` ],
            ...calls.some(call => call.isError)
                ? []
                : [ 'the agent never hit the weekday rule, so recovery was not tested' ]
        ]
    }
];

type Servers = {
    readonly topOrigin : string,
    readonly shopOrigin : string,
    readonly close : () => Promise<void>,
};

// Two https origins with a throwaway certificate: WebMCP's exposedTo only
// takes secure origins.
const startServers = async () : Promise<Servers> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'glottis-agent-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');

    await promisify(execFile)('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
    ]);

    const bundle = await build({
        entryPoints: [ path.join(root, 'test/agent/shop.ts') ],
        bundle:      true,
        write:       false,
        format:      'iife',
        platform:    'browser'
    });

    const script = bundle.outputFiles[0]?.text ?? '';
    const tls = { key: await readFile(key), cert: await readFile(cert) };

    const shop = createServer(tls, (request, response) => {
        response.setHeader('content-type', request.url?.startsWith('/shop.js')
            ? 'text/javascript'
            : 'text/html');

        response.end(request.url?.startsWith('/shop.js')
            ? script
            : '<!doctype html><title>Shop</title><script src="/shop.js"></script>');
    });

    const top = createServer(tls, (_request, response) => {
        response.setHeader('content-type', 'text/html');
        response.end('<!doctype html><title>Agent</title>');
    });

    const listen = (server : ReturnType<typeof createServer>) : Promise<number> => new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            resolve((server.address() as AddressInfo | null)?.port ?? 0);
        });
    });

    const [ shopPort, topPort ] = await Promise.all([ listen(shop), listen(top) ]);

    return {
        topOrigin:  `https://localhost:${ topPort }`,
        shopOrigin: `https://127.0.0.1:${ shopPort }`,

        close: async () => {
            shop.close();
            top.close();
            await rm(dir, { recursive: true, force: true });
        }
    };
};

type ListedTool = {
    readonly name : string,
    readonly description : string,
    readonly inputSchema : Record<string, unknown>,
};

type PageToolsOptions = { readonly page : Page, readonly shopOrigin : string };

const listTools = async ({ page, shopOrigin } : PageToolsOptions) : Promise<ReadonlyArray<ListedTool>> =>
    await page.evaluate(async origin => {
        type Registered = { readonly name : string, readonly description : string, readonly inputSchema ?: unknown };
        type Context = { readonly getTools : (options : unknown) => Promise<ReadonlyArray<Registered>> };

        const context = (document as unknown as { readonly modelContext : Context }).modelContext;
        const tools = await context.getTools({ fromOrigins: [ origin ] });

        return tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema: (typeof inputSchema === 'string'
                ? JSON.parse(inputSchema)
                : inputSchema ?? { type: 'object' }) as Record<string, unknown>
        }));
    }, shopOrigin);

type RunToolOptions = PageToolsOptions & { readonly name : string, readonly args : unknown };

const runTool = async ({ page, shopOrigin, name, args } : RunToolOptions) : Promise<string> =>
    await page.evaluate(async ({ origin, toolName, toolArgs }) => {
        type Context = {
            readonly getTools : (options : unknown) => Promise<ReadonlyArray<{ readonly name : string }>>,
            readonly executeTool : (tool : unknown, args : unknown) => Promise<string>,
        };

        const context = (document as unknown as { readonly modelContext : Context }).modelContext;
        const tools = await context.getTools({ fromOrigins: [ origin ] });
        const found = tools.find(candidate => candidate.name === toolName);

        return found
            ? (await context.executeTool(found, toolArgs ?? {}))
            : JSON.stringify({ content: [ { type: 'text', text: `There is no tool named ${ toolName }` } ], isError: true });
    }, { origin: shopOrigin, toolName: name, toolArgs: args });

type RunReport = {
    readonly scenario : string,
    readonly passed : boolean,
    readonly failures : ReadonlyArray<string>,
    readonly calls : ReadonlyArray<ToolCall>,
    readonly answer : string,
    readonly turns : number,
    readonly costUsd : number,
    readonly seconds : number,
    // When the agent fetched the tool list, and when the page's changed.
    readonly events : ReadonlyArray<string>,
};

type RunScenarioOptions = {
    readonly scenario : Scenario,
    readonly model : string,
    readonly servers : Servers,
};

const runScenario = async ({ scenario, model, servers } : RunScenarioOptions) : Promise<RunReport> => {
    const started = Date.now();
    const browser = await chromium.launch({ args: [ '--enable-features=WebMCP' ] });

    try {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await context.newPage();
        const { shopOrigin, topOrigin } = servers;

        await page.goto(`${ topOrigin }/`);

        await page.evaluate(src => {
            const frame = document.createElement('iframe');

            frame.allow = 'tools';
            frame.src = src;
            document.body.append(frame);
        }, `${ shopOrigin }/?top=${ encodeURIComponent(topOrigin) }`);

        const deadline = Date.now() + 10_000;

        // eslint-disable-next-line no-await-in-loop -- polling
        while ((await listTools({ page, shopOrigin })).length === 0) {
            if (Date.now() > deadline) {
                throw new Error('The shop registered no tools');
            }

            // eslint-disable-next-line no-await-in-loop -- polling
            await page.waitForTimeout(100);
        }

        const calls : Array<ToolCall> = [];
        const mcp = new McpServer({ name: `shop`, version: `1.0.0` }, { capabilities: { tools: { listChanged: true } } });
        let known = (await listTools({ page, shopOrigin })).map(({ name }) => name).join(',');

        const events : Array<string> = [];
        let onFetched = () : void => undefined;

        mcp.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const tools = await listTools({ page, shopOrigin });

            onFetched();

            events.push(`${ Date.now() - started }ms list -> ${ tools.map(({ name }) => name).join(' ') }`);

            return { tools: [ ...tools ] };
        });

        mcp.server.setRequestHandler(CallToolRequestSchema, async request => {
            const { name, arguments: args } = request.params;

            const result = JSON.parse(await runTool({ page, shopOrigin, name, args })) as {
                readonly content : ReadonlyArray<{ readonly type : 'text', readonly text : string }>,
                readonly isError ?: boolean,
            };

            calls.push({ name, args, isError: result.isError === true, text: result.content[0]?.text ?? '' });

            const now = (await listTools({ page, shopOrigin })).map(({ name: listed }) => listed).join(',');

            events.push(`${ Date.now() - started }ms call ${ name }; page now has ${ now }`);

            if (now !== known) {
                known = now;

                // The agent builds its next request from the tool list it
                // has; answering before it has fetched the new one leaves a
                // fresh bound tool out of that request.
                const fetched = new Promise<void>(resolve => {
                    onFetched = resolve;
                    setTimeout(resolve, 1000);
                });

                await mcp.server.sendToolListChanged();
                await fetched;
                events.push(`${ Date.now() - started }ms sent list_changed, and the agent fetched the list`);
            }

            // glottis already returns MCP's tool result shape.
            return result;
        });

        const cwd = await mkdtemp(path.join(os.tmpdir(), 'glottis-agent-cwd-'));
        let answer = '';
        let turns = 0;
        let costUsd = 0;

        try {
            for await (const message of query({
                prompt:  scenario.prompt,
                options: {
                    model,
                    cwd,
                    tools:           [],
                    mcpServers:      { shop: { type: 'sdk', name: 'shop', instance: mcp } },
                    strictMcpConfig: true,
                    settingSources:  [],
                    persistSession:  false,
                    maxTurns:        30,
                    systemPrompt:    `You are a shopping assistant working a web shop through its tools. Do what the user asks with the tools, then answer in a sentence or two.`,
                    canUseTool:      (_name, input) => Promise.resolve({ behavior: 'allow', updatedInput: input })
                }
            })) {
                if (message.type === 'result') {
                    answer = message.subtype === 'success'
                        ? message.result
                        : `(ended: ${ message.subtype })`;

                    turns = message.num_turns;
                    costUsd = message.total_cost_usd;
                }
            }
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }

        const shopFrame = page.frames().find((frame : Frame) => frame.url().startsWith(shopOrigin));
        const state = await shopFrame?.evaluate(() => (window as unknown as { readonly __shop : ShopState }).__shop);

        if (!state) {
            throw new Error('Could not read the shop’s state');
        }

        const failures = scenario.check({ state, calls, answer });

        return {
            scenario: scenario.name,
            passed:   failures.length === 0,
            failures,
            calls,
            answer,
            turns,
            costUsd,
            seconds:  Math.round((Date.now() - started) / 100) / 10,
            events
        };
    } finally {
        await browser.close();
    }
};

// Pacific time, for the report's file name.
const pacificStamp = () : string => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone:     'America/Los_Angeles',
        year:         'numeric',
        month:        '2-digit',
        day:          '2-digit',
        hour:         '2-digit',
        minute:       '2-digit',
        second:       '2-digit',
        hourCycle:    'h23',
        timeZoneName: 'short'
    }).formatToParts(new Date()).map(({ type, value }) => [ type, value ]));

    const part = (name : string) : string => parts[name] ?? '';

    return `${ part('year') }-${ part('month') }-${ part('day') }T${ part('hour') }-${ part('minute') }-${ part('second') }-${ part('timeZoneName') }`;
};

const main = async () : Promise<void> => {
    const { values } = parseArgs({
        options: {
            scenario: { type: 'string', multiple: true },
            runs:     { type: 'string', default: '1' },
            model:    { type: 'string', default: 'claude-sonnet-5-5' }
        }
    });

    const chosen = values.scenario?.length
        ? SCENARIOS.filter(({ name }) => values.scenario?.includes(name))
        : SCENARIOS;

    if (chosen.length === 0) {
        throw new Error(`No such scenario. Scenarios: ${ SCENARIOS.map(({ name }) => name).join(', ') }`);
    }

    const runs = Number(values.runs);
    const servers = await startServers();
    const reports : Array<RunReport> = [];

    try {
        for (const scenario of chosen) {
            for (let run = 1; run <= runs; run += 1) {
                say(`▶ ${ scenario.name } (${ run }/${ runs }): ${ scenario.what }`);

                // eslint-disable-next-line no-await-in-loop -- one browser and one agent at a time
                const report = await runScenario({ scenario, model: values.model, servers });

                reports.push(report);

                for (const call of report.calls) {
                    say(`    ${
                        call.isError
                            ? '✗'
                            : '→'
                        } ${ call.name }(${ JSON.stringify(call.args) })${
                            call.isError
                                ? `: ${ call.text }`
                                : ''
                        }`);
                }

                say(`    ${
                    report.passed
                        ? 'PASS'
                        : 'FAIL'
                    } in ${ report.seconds }s, ${ report.turns } turns, $${ report.costUsd.toFixed(4) }`);

                say(`    answer: ${ report.answer.replaceAll('\n', ' ') }`);

                for (const failure of report.failures) {
                    say(`    - ${ failure }`);
                }
            }
        }
    } finally {
        await servers.close();
    }

    const passed = reports.filter(report => report.passed).length;
    const dir = path.join(root, 'agent-results');
    const file = path.join(dir, `${ pacificStamp() }.json`);

    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify({ model: values.model, reports }, null, 4));

    say(`\n${ passed }/${ reports.length } passed, $${ reports.reduce((sum, report) => sum + report.costUsd, 0).toFixed(4) } in all. Report: ${ path.relative(root, file) }`);

    process.exitCode = passed === reports.length
        ? 0
        : 1;
};

main().catch((error : unknown) => {
    process.stderr.write(`${
        error instanceof Error
            ? error.stack ?? error.message
            : String(error)
        }\n`);

    process.exitCode = 1;
});
