import { z } from 'zod';

import type { Connection, ExportsContext } from '../src';

import { connect, DisconnectedError, serve } from '../src';

type Local = {
    readonly data : { readonly items : ReadonlyArray<string> },
    readonly when : Date,
    readonly getItems : () => ReadonlyArray<string>,
    readonly mutate : (items : Array<string>) => number,
    readonly greet : () => string,
    readonly call : (args : { readonly fn : (value : number) => Promise<number> }) => Promise<number>,
};

type MyceliumGlobal = { readonly connect : (options ?: { readonly service ?: string }) => Promise<Connection<Local>> };

const items = [ 'a', 'b' ];

const server = serve({
    domain:  '*',
    service: 'local-test',
    props:   z.object({ name: z.string().default('nobody') }),

    exports: ({ props, onProps } : ExportsContext<{ readonly name : string }>) => {
        let name = props.name;

        onProps(next => {
            name = next.name;
        });

        return {
            data:     { items },
            when:     new Date(5),
            getItems: () => items,

            mutate: (received : Array<string>) => {
                received.push('changed on the page');

                return received.length;
            },

            greet: () => `hello ${ name }`,
            call:  async ({ fn } : { readonly fn : (value : number) => Promise<number> }) => await fn(2)
        };
    }
});

afterAll(() => {
    server.stop();
});

describe('connecting to a service on this page', () => {
    it('is reachable through window.mycelium.connect()', async () => {
        const global = (window as unknown as { readonly mycelium : MyceliumGlobal }).mycelium;
        const page = await global.connect({ service: 'local-test' });

        expect(await page.exports.greet()).toBe('hello nobody');

        await page.disconnect();
    });

    it('only connects to this page from the installed global', async () => {
        type RemoteAttempt = { readonly connect : (options : { readonly url : string }) => Promise<unknown> };

        const global = (window as unknown as { readonly mycelium : RemoteAttempt }).mycelium;

        await expect(global.connect({ url: `https://example.com` })).rejects.toThrow(`only connects to services on this page`);
    });

    it('copies data both ways, as a remote connection would', async () => {
        const page = await connect<Local>({ service: 'local-test' });
        const mine = [ 'x' ];

        expect(await page.exports.mutate(mine)).toBe(2);
        expect(mine).toEqual([ 'x' ]);

        const received = await page.exports.getItems();

        expect(received).toEqual([ 'a', 'b' ]);
        expect(received).not.toBe(items);
        expect(page.exports.when).toEqual(new Date(5));

        await page.disconnect();
    });

    it('passes functions by reference', async () => {
        const page = await connect<Local>({ service: 'local-test' });

        expect(await page.exports.call({ fn: value => Promise.resolve(value * 10) })).toBe(20);

        await page.disconnect();
    });

    it('validates and updates props', async () => {
        const page = await connect<Local>({ service: 'local-test', props: { name: 'Grace' } });

        expect(await page.exports.greet()).toBe('hello Grace');

        await page.updateProps({ name: 'Ada' });
        expect(await page.exports.greet()).toBe('hello Ada');

        await expect(page.updateProps({ name: 1 })).rejects.toThrow('Invalid props');
        await expect(connect({ service: 'local-test', props: { name: 2 } })).rejects.toThrow('Invalid props');

        await page.disconnect();
        await expect(page.exports.greet()).rejects.toBeInstanceOf(DisconnectedError);
    });

    it('pulls the current exports', async () => {
        const page = await connect<Local>({ service: 'local-test' });
        const latest = await page.getExports();

        expect(await latest.greet()).toBe('hello nobody');

        await page.disconnect();
    });

    it('refuses a service this page does not serve', async () => {
        await expect(connect({ service: 'not-here' })).rejects.toThrow('No service "not-here"');
    });

    it('ends local connections when the service stops', async () => {
        const reasons : Array<string> = [];
        const temporary = serve({ domain: '*', service: 'local-stop', exports: { ping: () => 'pong' } });
        const page = await connect<{ readonly ping : () => string }>({ service: `local-stop`, onDisconnect: ({ reason }) => reasons.push(reason) });

        expect(await page.exports.ping()).toBe('pong');

        temporary.stop();

        expect(reasons).toEqual([ 'stopped' ]);
        await expect(page.exports.ping()).rejects.toThrow('stopped serving');
    });

    it('pushes updated exports to local connections', async () => {
        let version = 1;
        const changes : Array<number> = [];
        const temporary = serve({ domain: '*', service: 'local-update', exports: () => ({ version }) });

        const page = await connect<{ readonly version : number }>({
            service:         'local-update',
            onExportsChange: ({ exports }) => changes.push(exports.version)
        });

        version = 2;
        await temporary.updateExports();

        expect(changes).toEqual([ 2 ]);
        expect(page.exports.version).toBe(2);

        temporary.stop();
    });

    it('connects to the default service when given no options', async () => {
        await expect(connect()).rejects.toThrow('No service "default"');

        type Global = { readonly connect : () => Promise<unknown> };

        const global = (window as unknown as { readonly mycelium : Global }).mycelium;

        await expect(global.connect()).rejects.toThrow('No service "default"');
    });

    it('sends no goodbye to its own local connections as the page hides', async () => {
        const page = await connect<Local>({ service: 'local-test' });

        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));

        expect(await page.exports.greet()).toBe('hello nobody');

        await page.disconnect();
    });
});
