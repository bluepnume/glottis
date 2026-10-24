import { connect } from '../src';

import { cleanFrames, delay, env, pageUrl } from './common';

type Factory = {
    readonly origin : string,
    readonly initialName : string,
    readonly hasWindow : boolean,
    readonly increment : () => number,
    readonly latestName : () => string,
    readonly pullName : () => Promise<string>,
    readonly emit : () => Promise<unknown>,
};

const url = pageUrl({ scenario: 'factory' });

afterEach(cleanFrames);

describe('props and per-connection exports', () => {
    it('builds exports per connection from the caller origin, window and props', async () => {
        const page = await connect<Factory>({ url, props: { name: 'Ada' } });

        expect(page.exports.origin).toBe(env.origin);
        expect(page.exports.initialName).toBe('Ada');
        expect(page.exports.hasWindow).toBe(true);

        await page.disconnect();
    });

    it('keeps state separate for every connection', async () => {
        const first = await connect<Factory>({ url, props: { name: 'one' } });
        const second = await connect<Factory>({ url, props: { name: 'two' } });

        await first.exports.increment();
        await first.exports.increment();

        expect(await first.exports.increment()).toBe(3);
        expect(await second.exports.increment()).toBe(1);

        await first.disconnect();
        await second.disconnect();
    });

    it('merges updateProps into the current props and tells the page', async () => {
        const page = await connect<Factory>({ url, props: { name: 'before' } });

        await page.updateProps({ name: 'after' });

        expect(await page.exports.latestName()).toBe('after');

        await page.disconnect();
    });

    it('lets the page pull the latest props', async () => {
        const page = await connect<Factory>({ url, props: { name: 'pulled' } });

        expect(await page.exports.pullName()).toBe('pulled');

        await page.disconnect();
    });

    it('passes functions in props by reference', async () => {
        const messages : Array<string> = [];

        const page = await connect<Factory>({
            url,
            props: { name: 'callback', onEvent: (message : string) => messages.push(message) }
        });

        await page.exports.emit();

        expect(messages).toEqual([ 'hello callback' ]);

        await page.disconnect();
    });

    it('refuses props that fail the page schema at connect', async () => {
        await expect(connect({ url, props: { name: 42 } })).rejects.toThrow('Invalid props');
    });

    it('refuses an update that fails the schema and keeps the previous props', async () => {
        const page = await connect<Factory>({ url, props: { name: 'kept' } });

        await expect(page.updateProps({ name: 7 })).rejects.toThrow('Invalid props');

        await delay(10);
        expect(await page.exports.latestName()).toBe('kept');
        expect(await page.exports.pullName()).toBe('kept');

        await page.disconnect();
    });
});
