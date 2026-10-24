import type { DisconnectInfo } from '../src';

import { connect } from '../src';

import { cleanFrames, pageUrl, waitFor } from './common';

type AskFirst = {
    readonly allowed : boolean,
    readonly reload : () => void,
};

const url = pageUrl({ scenario: 'askFirst' });

afterEach(cleanFrames);

// The page answers after 2 seconds, longer than these timeouts: once it has
// announced itself, connect() waits for its answer, however long.
describe('a page that asks its user first', () => {
    it('connects once the user agrees, past the connect timeout', async () => {
        const page = await connect<AskFirst>({ url, timeout: 1500 });

        expect(page.exports.allowed).toBe(true);

        await page.disconnect();
    });

    it('rejects with the page error when the user declines', async () => {
        await expect(connect({ url, timeout: 1500, props: { decline: true } })).rejects.toThrow('The user declined');
    });

    it('reconnects after a reload, waiting for the page to ask again', async () => {
        const events : Array<string> = [];

        const page = await connect<AskFirst>({
            url,
            timeout:      1500,
            onDisconnect: ({ reason } : DisconnectInfo) => events.push(reason),
            onReconnect:  () => events.push('reconnect')
        });

        await page.exports.reload();
        await waitFor({ check: () => events.includes('reconnect'), what: 'the reconnect', timeout: 8000 });

        expect(events).toEqual([ 'navigated', 'reconnect' ]);

        await page.disconnect();
    });
});
