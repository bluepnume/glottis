import { connect } from '../src';

import { cleanFrames, pageUrl } from './common';

afterEach(cleanFrames);

describe('the script-tag bundle', () => {
    it('serves from dist/spor.min.js through window.spor', async () => {
        type Bundle = {
            readonly add : (args : { readonly a : number, readonly b : number }) => number,
            readonly version : string,
        };

        const page = await connect<Bundle>({
            url: pageUrl({ scenario: 'basic', page: 'bundle' })
        });

        expect(page.exports.version).toBe('bundle');
        expect(await page.exports.add({ a: 20, b: 22 })).toBe(42);

        await page.disconnect();
    });
});
