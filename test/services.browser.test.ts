import { connect, ConnectTimeoutError } from '../src';

import { cleanFrames, pageUrl } from './common';

type Which = { readonly which : () => string };

afterEach(cleanFrames);

describe('named services', () => {
    it('connects to the default service or a named one', async () => {
        const url = pageUrl({ scenario: 'services' });
        const plain = await connect<Which>({ url });
        const cart = await connect<Which>({ url, service: 'cart' });

        expect(await plain.exports.which()).toBe('default');
        expect(await cart.exports.which()).toBe('cart');
        expect(cart.service).toBe('cart');
        expect(cart.manifest.service).toBe('cart');

        await plain.disconnect();
        await cart.disconnect();
    });

    it('refuses to serve the same name twice on one page', async () => {
        const page = await connect<{ readonly message : string }>({ url: pageUrl({ scenario: `services` }), service: `duplicate-error` });

        expect(page.exports.message).toContain('"cart" is already being served');

        await page.disconnect();
    });

    it('times out for a service the page does not serve', async () => {
        await expect(connect({ url: pageUrl({ scenario: 'services' }), service: 'nope', timeout: 500 }))
            .rejects.toBeInstanceOf(ConnectTimeoutError);
    });
});
