import { send } from 'post-robot';

import { MESSAGE } from '../src';

import { cleanFrames, env, loadFrame, pageUrl } from './common';

afterEach(cleanFrames);

// Messages a third party could send, naming connections it does not own.
describe('forged messages', () => {
    it('refuses a request for a connection the page does not know', async () => {
        const frame = await loadFrame({ url: pageUrl({ scenario: 'basic' }) });
        const win = frame.contentWindow;

        if (!win) {
            throw new Error('Expected a window');
        }

        await expect(send(win, MESSAGE.GET_EXPORTS, { connectionId: `forged` }, { domain: env.foreignOrigin }).toPromise())
            .rejects.toThrow('Unknown connection forged');
    });

    it('refuses to connect to a service the page does not serve', async () => {
        const frame = await loadFrame({ url: pageUrl({ scenario: 'basic' }) });
        const win = frame.contentWindow;

        if (!win) {
            throw new Error('Expected a window');
        }

        await expect(send(win, MESSAGE.CONNECT, { service: `nope`, props: {}, connectionId: `forged` }, { domain: env.foreignOrigin }).toPromise())
            .rejects.toThrow('No service "nope"');
    });

    it('refuses a page message for a connection the caller does not know', async () => {
        const frame = await loadFrame({ url: pageUrl({ scenario: 'basic' }) });

        // Any caller-side listener will do; it is installed by the first connect.
        const { connect } = await import('../src');
        const page = await connect({ target: frame, domain: env.foreignOrigin });

        await expect(send(window, MESSAGE.GET_PROPS, { connectionId: 'forged' }, { domain: env.origin }).toPromise())
            .rejects.toThrow('Unknown connection forged');

        await page.disconnect();
    });
});
