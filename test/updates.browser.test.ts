import { connect, DisconnectedError } from '../src';

import { cleanFrames, pageUrl, waitFor } from './common';

type Updates = {
    readonly version : number,
    readonly bump : () => void,
    readonly replace : () => void,
    readonly stop : () => void,
    readonly replaced ?: boolean,
    readonly read ?: () => string,
};

const url = pageUrl({ scenario: 'updates' });

afterEach(cleanFrames);

describe('changing and stopping exports', () => {
    it('pushes rebuilt exports to the caller', async () => {
        const changes : Array<number> = [];

        const page = await connect<Updates>({
            url,
            onExportsChange: ({ exports }) => changes.push(exports.version)
        });

        const { bump } = page.exports;

        await bump();
        await waitFor({ check: () => changes.length === 1, what: 'the exports change' });

        expect(changes).toEqual([ 2 ]);
        expect(page.exports.version).toBe(2);

        // a reference taken before the update still works
        await bump();
        await waitFor({ check: () => changes.length === 2, what: 'the second change' });
        expect(page.exports.version).toBe(3);

        await page.disconnect();
    });

    it('swaps in new exports and lets the caller pull them', async () => {
        const page = await connect<Updates>({ url });

        await page.exports.replace();

        const latest = await page.getExports();

        expect(latest.replaced).toBe(true);
        expect(await latest.read?.()).toBe('replaced');

        await page.disconnect();
    });

    it('ends the connection when the page stops serving', async () => {
        const reasons : Array<string> = [];

        const page = await connect<Updates>({ url, onDisconnect: ({ reason }) => reasons.push(reason) });

        await page.exports.stop();
        await waitFor({ check: () => reasons.length === 1, what: 'the disconnect' });

        expect(reasons).toEqual([ 'stopped' ]);
        await expect(page.exports.bump()).rejects.toBeInstanceOf(DisconnectedError);
        await expect(page.updateProps({})).rejects.toThrow('stopped serving');
        expect(page.frame?.isConnected).toBe(false);
    });
});
