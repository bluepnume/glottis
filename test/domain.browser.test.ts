import { connect, ConnectTimeoutError, DomainError, serve } from '../src';

import { cleanFrames, env, loadFrame, pageUrl } from './common';

afterEach(cleanFrames);

describe('who may connect', () => {
    it('refuses a caller the page does not list', async () => {
        await expect(connect({ url: pageUrl({ scenario: 'restricted' }) })).rejects.toThrow(`Origin ${ env.origin } is not allowed`);
    });

    it('names the refusal as a DomainError', async () => {
        const error = await connect({ url: pageUrl({ scenario: 'restricted' }) }).catch((err : unknown) => err);

        expect((error as Error).name).toBe(new DomainError('x').name);
    });

    it('asks a domain callback, sync or async', async () => {
        const page = await connect<{ readonly ok : () => string }>({ url: pageUrl({ scenario: 'callbackDomain' }) });

        expect(await page.exports.ok()).toBe('allowed by callback');

        await page.disconnect();
    });

    it('ignores a page at an origin the caller did not expect', async () => {
        const error = await connect({
            url:     pageUrl({ scenario: 'basic' }),
            domain:  'https://somewhere-else.example',
            timeout: 600
        }).catch((err : unknown) => err);

        expect(error).toBeInstanceOf(ConnectTimeoutError);
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });

    it('accepts a page whose origin passes the caller domain callback', async () => {
        const page = await connect({
            url:    pageUrl({ scenario: 'basic' }),
            domain: ({ origin }) => origin === env.foreignOrigin
        });

        expect(page.origin).toBe(env.foreignOrigin);

        await page.disconnect();
    });

    it('needs a domain for a frame the caller already has', async () => {
        const frame = await loadFrame({ url: pageUrl({ scenario: 'basic' }) });

        await expect(connect({ target: frame })).rejects.toThrow('needs a `domain`');
    });

    it('refuses a url together with an existing frame', async () => {
        const frame = await loadFrame({ url: pageUrl({ scenario: 'basic' }) });

        await expect(connect({ url: pageUrl({ scenario: `basic` }), target: frame, domain: `*` })).rejects.toThrow(`not both`);
    });

    it('points the old top-level domain at clients', () => {
        expect(() => serve({ domain: `*`, exports: {} } as unknown as Parameters<typeof serve>[0])).toThrow(`in place of \`domain\``);
    });

    it('needs a domain to allow other windows', () => {
        expect(() => serve({ clients: { remoteWindow: { allowed: true } }, exports: {} })).toThrow(`needs \`clients.remoteWindow.domain\``);
    });

    it('refuses other windows unless the page allows them', async () => {
        await expect(connect({ url: pageUrl({ scenario: `localOnly` }) })).rejects.toThrow(`does not accept connections from other windows`);
    });

    it('leaves out window.glottis when no service allows scripts on the page', async () => {
        const page = await connect<{ readonly hasGlobal : () => boolean }>({ url: pageUrl({ scenario: `remoteOnly` }) });

        expect(await page.exports.hasGlobal()).toBe(false);

        await page.disconnect();
    });
});
