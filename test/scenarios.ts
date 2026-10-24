// What a serving test page does, by name. Each scenario calls serve() the way
// a real page would; the suites connect to it from another origin.

import { z } from 'zod';

import type { ExportsContext, Server } from '../src';

import { describe as describeExport, serve } from '../src';

type ScenarioOptions = {
    // The test page's origin, for scenarios that restrict who may connect.
    readonly parent : string,
};

type Scenario = (options : ScenarioOptions) => void;

const basic : Scenario = () => {
    serve({
        domain:      '*',
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
        domain: '*',
        props:  z.object({ name: z.string(), onEvent: z.function().optional() }),

        exports: ({ origin, props, onProps, getProps, window: caller } : ExportsContext<FactoryProps>) => {
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
        domain:  '*',
        exports: {
            cart: {
                add: describeExport.function({
                    handler:     ({ id, quantity } : { readonly id : string, readonly quantity : number }) => `${ id } x${ quantity }`,
                    description: 'Add a product to the cart',
                    input:       z.object({ id: z.string(), quantity: z.number().int().min(1).default(1) }),
                    output:      z.string()
                })
            },
            plain: describeExport.function({
                handler:     ({ id } : { readonly id : unknown }) => id,
                description: 'Takes anything; the schema is metadata only',
                input:       { type: 'object', properties: { id: { type: 'string' } } }
            }),
            broken: describeExport.function({ handler: (value : unknown) => value, input: brokenSchema }),
            custom: describeExport.function({
                handler:    shout,
                input:      customSchema,
                jsonSchema: { input: { type: 'string' } }
            }),
            confirm: describeExport.function({
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
        domain: '*',

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
    serve({ domain: 'https://not-the-caller.example', exports: { secret: () => 'nope' } });
};

const callbackDomain : Scenario = ({ parent }) => {
    serve({
        domain:  ({ origin }) => Promise.resolve(origin === parent),
        exports: { ok: () => 'allowed by callback' }
    });
};

const services : Scenario = () => {
    serve({ domain: '*', service: 'cart', exports: { which: () => 'cart' } });
    serve({ domain: '*', exports: { which: () => 'default' } });

    try {
        serve({ domain: '*', service: 'cart', exports: {} });
    } catch (err) {
        serve({
            domain:  `*`,
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
        serve({ domain: '*', exports: { late: () => 'served late' } });
    }, 300);
};

// Serves to anyone at first; once reloaded, refuses everyone.
const refuseOnReload : Scenario = () => {
    const reloaded = sessionStorage.getItem('glottis-reloaded') === 'yes';

    sessionStorage.setItem('glottis-reloaded', 'yes');

    serve({
        domain: reloaded
            ? 'https://nobody.example'
            : '*',
        exports: {
            reload: () => {
                setTimeout(() => {
                    location.reload();
                }, 10);
            }
        }
    });
};

const none : Scenario = () => undefined;

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
