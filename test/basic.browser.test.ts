import type { Remote } from '../src';

import { connect, DisconnectedError } from '../src';

import { cleanFrames, env, pageUrl } from './common';

type Basic = {
    readonly version : string,
    readonly when : Date,
    readonly math : {
        readonly add : (args : { readonly a : number, readonly b : number }) => number,
        readonly fail : () => never,
    },
    readonly echo : (value : unknown) => unknown,
    readonly callBack : (args : { readonly fn : (value : number) => Promise<number> }) => Promise<number>,
    readonly counter : () => { readonly increment : () => number },
    readonly subscribe : (args : { readonly onTick : (tick : number) => unknown }) => () => void,
};

afterEach(cleanFrames);

describe('connecting to a page in a hidden iframe', () => {
    it('calls functions, reads constants and lists the manifest', async () => {
        const page = await connect<Basic>({ url: pageUrl({ scenario: 'basic' }) });

        expect(page.origin).toBe(env.foreignOrigin);
        expect(page.service).toBe('default');
        expect(page.exports.version).toBe('1.0');
        expect(page.exports.when).toEqual(new Date(0));
        expect(await page.exports.math.add({ a: 2, b: 3 })).toBe(5);
        expect(page.manifest.description).toBe('The basic test API');
        expect(Object.keys(page.manifest.functions)).toContain('math.add');

        await page.disconnect();
    });

    it('creates a hidden frame and removes it on disconnect', async () => {
        const page = await connect<Basic>({ url: pageUrl({ scenario: 'basic' }) });
        const { frame } = page;

        expect(frame?.isConnected).toBe(true);
        expect(frame?.getAttribute('aria-hidden')).toBe('true');
        expect(frame?.style.visibility).toBe('hidden');

        await page.disconnect();

        expect(frame?.isConnected).toBe(false);
    });

    it('rejects with the error the page threw', async () => {
        const page = await connect<Basic>({ url: pageUrl({ scenario: 'basic' }) });

        await expect(page.exports.math.fail()).rejects.toThrow('boom');
        await page.disconnect();
    });

    it('passes callbacks by reference and returns objects of live functions', async () => {
        const page = await connect<Basic>({ url: pageUrl({ scenario: 'basic' }) });

        expect(await page.exports.callBack({ fn: value => Promise.resolve(value) })).toBe(42);

        const counter : Remote<{ readonly increment : () => number }> = await page.exports.counter();

        expect(await counter.increment()).toBe(1);
        expect(await counter.increment()).toBe(2);

        await page.disconnect();
    });

    it('rejects calls after disconnect, including on references taken earlier', async () => {
        const page = await connect<Basic>({ url: pageUrl({ scenario: 'basic' }) });
        const counter = await page.exports.counter();

        await page.disconnect();

        await expect(page.exports.math.add({ a: 1, b: 1 })).rejects.toBeInstanceOf(DisconnectedError);
        await expect(counter.increment()).rejects.toThrow('disconnected');
    });
});
