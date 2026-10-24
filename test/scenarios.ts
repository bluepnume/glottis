// What a serving test page does, by name. Each scenario calls serve() the way
// a real page would; the suites connect to it from another origin.

import { z } from 'zod';

import type { ExportsContext, Server } from '../src';

import { CLIENT_TYPE, connect, serve, tool } from '../src';

type ScenarioOptions = {
    // The test page's origin, for scenarios that restrict who may connect.
    readonly parent : string,
};

type Scenario = (options : ScenarioOptions) => void;

const basic : Scenario = () => {
    serve({
        clients:     { remoteWindow: { allowed: true, domain: '*' } },
        description: 'The basic test API',
        exports:     {
            version: '1.0',
            when:    new Date(0),
            math:    {
                add: ({ a, b } : { readonly a : number, readonly b : number }) => a + b,

                fail: () => {
                    throw new Error('boom');
                }
            },
            echo:     (value : unknown) => value,
            callBack: async ({ fn } : { readonly fn : (value : number) => Promise<number> }) => (await fn(21)) * 2,

            counter: () => {
                let count = 0;

                return {
                    increment: () => {
                        count += 1;

                        return count;
                    }
                };
            },

            subscribe: ({ onTick } : { readonly onTick : (tick : number) => unknown }) => {
                let tick = 0;

                const timer = setInterval(() => {
                    tick += 1;
                    void Promise.resolve(onTick(tick)).catch(() => clearInterval(timer));
                }, 20);

                return () => {
                    clearInterval(timer);
                };
            },

            reload: () => {
                setTimeout(() => {
                    location.reload();
                }, 10);
            },

            fakeHide: ({ persisted } : { readonly persisted : boolean }) => {
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted }));
            },

            leave: () => {
                setTimeout(() => {
                    location.href = '/test/pages/blank.html';
                }, 10);
            }
        }
    });
};

type FactoryProps = {
    readonly name : string,
    readonly onEvent ?: (message : string) => Promise<unknown>,
};

const factory : Scenario = () => {
    serve({
        clients: { remoteWindow: { allowed: true, domain: '*' } },
        props:   z.object({ name: z.string(), onEvent: z.function().optional() }),

        exports: ({ client, props, onProps, getProps } : ExportsContext<FactoryProps>) => {
            if (client.type === CLIENT_TYPE.WEB_MCP) {
                throw new Error('This scenario serves windows only');
            }

            const { origin, window: caller } = client;
            let count = 0;
            let latest = props;

            onProps(next => {
                latest = next;
            });

            return {
                origin,
                initialName: props.name,
                hasWindow:   Boolean(caller),

                increment: () => {
                    count += 1;

                    return count;
                },

                latestName: () => latest.name,
                pullName:   async () => (await getProps()).name,
                emit:       () => latest.onEvent?.(`hello ${ latest.name }`)
            };
        }
    });
};

const described : Scenario = () => {
    const customSchema = {
        '~standard': {
            version: 1 as const,
            vendor:  'custom',

            validate: (value : unknown) => (typeof value === 'string'
                ? { value }
                : { issues: [ { message: 'expected a string', path: [ { key: 'value' } ] } ] })
        }
    };

    const brokenSchema = {
        '~standard': {
            version:    1 as const,
            vendor:     'broken',
            validate:   (value : unknown) => ({ value }),
            jsonSchema: {
                input: () => {
                    throw new Error('no JSON Schema for you');
                }
            }
        }
    };

    const shout = (value : string) : string => value.toUpperCase();

    serve({
        clients: { remoteWindow: { allowed: true, domain: '*' } },
        exports: {
            cart: {
                add: tool({
                    handler:     ({ id, quantity } : { readonly id : string, readonly quantity : number }) => `${ id } x${ quantity }`,
                    description: 'Add a product to the cart',
                    input:       z.object({ id: z.string(), quantity: z.number().int().min(1).default(1) }),
                    output:      z.string()
                })
            },
            plain: tool({
                handler:     ({ id } : { readonly id : unknown }) => id,
                description: 'Takes anything; the schema is metadata only',
                input:       { type: 'object', properties: { id: { type: 'string' } } }
            }),
            broken: tool({ handler: (value : unknown) => value, input: brokenSchema }),
            custom: tool({
                handler:    shout,
                input:      customSchema,
                jsonSchema: { input: { type: 'string' } }
            }),
            confirm: tool({
                handler: () => 'confirmed',
                once:    true
            }),
            undescribed: () => 'plain function'
        }
    });
};

const updates : Scenario = () => {
    let version = 1;

    const server : Server<Readonly<Record<string, unknown>>> = serve<Readonly<Record<string, unknown>>>({
        clients: { remoteWindow: { allowed: true, domain: '*' } },

        exports: () => ({
            version,

            bump: async () => {
                version += 1;
                await server.updateExports();
            },

            replace: async () => {
                await server.updateExports({ replaced: true, read: () => 'replaced' });
            },

            stop: () => {
                setTimeout(() => {
                    server.stop();
                }, 10);
            }
        })
    });
};

const restricted : Scenario = () => {
    serve({ clients: { remoteWindow: { allowed: true, domain: `https://not-the-caller.example` } }, exports: { secret: () => `nope` } });
};

const callbackDomain : Scenario = ({ parent }) => {
    serve({
        clients: { remoteWindow: { allowed: true, domain: ({ origin }) => Promise.resolve(origin === parent) } },
        exports: { ok: () => 'allowed by callback' }
    });
};

const services : Scenario = () => {
    serve({ clients: { remoteWindow: { allowed: true, domain: `*` } }, service: `cart`, exports: { which: () => `cart` } });
    serve({ clients: { remoteWindow: { allowed: true, domain: '*' } }, exports: { which: () => 'default' } });

    try {
        serve({ clients: { remoteWindow: { allowed: true, domain: '*' } }, service: 'cart', exports: {} });
    } catch (err) {
        serve({
            clients: { remoteWindow: { allowed: true, domain: `*` } },
            service: `duplicate-error`,
            exports: {
                message: err instanceof Error
                    ? err.message
                    : ``
            }
        });
    }
};

const late : Scenario = () => {
    setTimeout(() => {
        serve({ clients: { remoteWindow: { allowed: true, domain: '*' } }, exports: { late: () => 'served late' } });
    }, 300);
};

// Serves to anyone at first; once reloaded, refuses everyone.
const refuseOnReload : Scenario = () => {
    const reloaded = sessionStorage.getItem('glottis-reloaded') === 'yes';

    sessionStorage.setItem('glottis-reloaded', 'yes');

    serve({
        clients: {
            remoteWindow: {
                allowed: true,
                domain:  reloaded
                    ? 'https://nobody.example'
                    : '*'
            }
        },
        exports: {
            reload: () => {
                setTimeout(() => {
                    location.reload();
                }, 10);
            }
        }
    });
};

// Takes its time to answer, as a page asking its user would, and declines
// when the caller's props say so.
const askFirst : Scenario = () => {
    serve({
        clients: { remoteWindow: { allowed: true, domain: '*' } },

        exports: async ({ props } : ExportsContext<{ readonly decline ?: boolean }>) => {
            await new Promise(resolve => {
                setTimeout(resolve, 2000);
            });

            if (props.decline) {
                throw new Error('The user declined');
            }

            return {
                allowed: true,

                reload: () => {
                    setTimeout(() => {
                        location.reload();
                    }, 10);
                }
            };
        }
    });
};

// Serves only to scripts on its own page: remote windows are off by default.
const localOnly : Scenario = () => {
    serve({ exports: { secret: () => 'only for this page' } });
};

// Serves to other windows but not to scripts on its own page, so it has no
// window.glottis.
const remoteOnly : Scenario = () => {
    serve({
        clients: { remoteWindow: { allowed: true, domain: '*' }, localWindow: { allowed: false } },
        exports: { hasGlobal: () => 'glottis' in window }
    });
};

const none : Scenario = () => undefined;

type ToolRegistry = {
    registerTool : (tool : { readonly name : string }, options ?: unknown) => Promise<void>,
};

// Offers a tool to agents, and tells the test page what this frame logged
// and which tools the browser accepted from it.
const webMcp : Scenario = () => {
    const logged : Array<string> = [];
    const accepted : Array<string> = [];
    // eslint-disable-next-line no-console -- the test reads what this frame logs
    const original = console.error;

    // eslint-disable-next-line no-console -- the test reads what this frame logs
    console.error = (...args : ReadonlyArray<unknown>) => {
        logged.push(args.map(String).join(' '));
        original(...args);
    };

    const registry = (document as unknown as { readonly modelContext ?: ToolRegistry }).modelContext;

    if (registry) {
        const register = registry.registerTool.bind(registry);

        registry.registerTool = async (definition, options) => {
            await register(definition, options);
            accepted.push(definition.name);
        };
    }

    serve({
        clients: { remoteWindow: { allowed: true, domain: '*' }, webMcp: { allowed: true } },

        exports: ({ client }) => (client.type === CLIENT_TYPE.WEB_MCP
            ? { greet: tool({ description: 'Greet', handler: () => 'hello from the frame' }) }
            : { logged: () => logged, tools: () => accepted })
    });
};

type WebMcpFrame = { readonly logged : () => ReadonlyArray<string>, readonly tools : () => ReadonlyArray<string> };

// A top-level page framing the webMcp scenario from another origin, once
// with allow="tools" and once without. Only a top-level page can delegate
// the permission: the test page is itself a frame.
const webMcpHost : Scenario = ({ parent }) => {
    const url = `${ parent }/test/pages/serve.html?scenario=webMcp&parent=${ encodeURIComponent(location.origin) }`;
    const granted = connect<WebMcpFrame>({ url, target: { type: 'iframe', attributes: { allow: 'tools' } } });
    const refused = connect<WebMcpFrame>({ url, target: { type: 'iframe' } });

    serve({
        clients: { remoteWindow: { allowed: true, domain: '*' } },
        exports: {
            granted: async () => {
                const { exports } = await granted;

                return { tools: await exports.tools(), logged: await exports.logged() };
            },

            refused: async () => {
                const { exports } = await refused;

                return { tools: await exports.tools(), logged: await exports.logged() };
            }
        }
    });
};

const SCENARIOS : Readonly<Record<string, Scenario>> = {
    basic,
    factory,
    described,
    updates,
    restricted,
    callbackDomain,
    services,
    late,
    refuseOnReload,
    askFirst,
    localOnly,
    remoteOnly,
    webMcp,
    webMcpHost,
    none
};

type RunScenarioOptions = ScenarioOptions & {
    readonly name : string,
};

export const runScenario = ({ name, parent } : RunScenarioOptions) : void => {
    const scenario = SCENARIOS[name];

    if (!scenario) {
        throw new Error(`Unknown scenario ${ name }`);
    }

    scenario({ parent });
};
