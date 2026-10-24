import type { DisconnectInfo } from '../src';

import { connect } from '../src';

import { pageUrl, waitFor } from './common';

type Basic = { readonly version : string };

describe('popups', () => {
    it('opens the page in a popup and closes it on disconnect', async () => {
        const page = await connect<Basic>({ url: pageUrl({ scenario: `basic` }), target: { type: `popup`, width: 400, height: 300 } });

        expect(page.exports.version).toBe('1.0');
        expect(page.frame).toBeUndefined();

        const popup = page.window;

        await page.disconnect();
        await waitFor({ check: () => Boolean(popup?.closed), what: 'the popup to close' });
    });

    it('ends the connection when the user closes the popup', async () => {
        const reasons : Array<string> = [];

        const page = await connect<Basic>({
            url:          pageUrl({ scenario: 'basic' }),
            target:       { type: 'popup' },
            onDisconnect: ({ reason } : DisconnectInfo) => reasons.push(reason)
        });

        page.window?.close();
        await waitFor({ check: () => reasons.length === 1, what: 'the close' });

        expect(reasons).toEqual([ 'closed' ]);
    });
});
