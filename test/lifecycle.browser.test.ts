import type { DisconnectInfo } from '../src';

import { connect, ConnectTimeoutError, DisconnectedError } from '../src';

import { cleanFrames, delay, env, loadFrame, pageUrl, waitFor } from './common';

type Basic = {
    readonly fakeHide : (args : { readonly persisted : boolean }) => void,
    readonly version : string,
    readonly echo : (value : unknown) => unknown,
    readonly reload : () => void,
    readonly leave : () => void,
};

afterEach(cleanFrames);

describe('connection lifecycle', () => {
    it('times out with a message naming the likely causes, and removes the frame', async () => {
        const error = await connect({ url: pageUrl({ scenario: 'none' }), timeout: 400 }).catch((err : unknown) => err);

        expect(error).toBeInstanceOf(ConnectTimeoutError);
        expect((error as Error).message).toContain('frame-ancestors');
        expect((error as Error).message).toContain('"default"');
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });

    it('waits for a page that serves after it loads', async () => {
        const page = await connect<{ readonly late : () => string }>({ url: pageUrl({ scenario: 'late' }) });

        expect(await page.exports.late()).toBe('served late');

        await page.disconnect();
    });

    it('cancels with an AbortSignal', async () => {
        const controller = new AbortController();
        const connecting = connect({ url: pageUrl({ scenario: 'none' }), signal: controller.signal });

        controller.abort(new Error('changed my mind'));

        await expect(connecting).rejects.toThrow('changed my mind');
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });

    it('rejects at once for a signal that already aborted', async () => {
        await expect(connect({ url: pageUrl({ scenario: 'basic' }), signal: AbortSignal.abort() })).rejects.toThrow();
    });

    it('connects to a frame that loaded earlier, and leaves it in place on disconnect', async () => {
        const frame = await loadFrame({ url: pageUrl({ scenario: 'basic' }) });

        await delay(300);

        const page = await connect<Basic>({ target: frame, domain: env.foreignOrigin });

        expect(page.frame).toBe(frame);
        expect(page.exports.version).toBe('1.0');

        await page.disconnect();
        expect(frame.isConnected).toBe(true);
    });

    it('connects to a window passed directly', async () => {
        const frame = await loadFrame({ url: pageUrl({ scenario: 'basic' }) });
        const win = frame.contentWindow;

        if (!win) {
            throw new Error('Expected a window');
        }

        const page = await connect<Basic>({ target: win, domain: env.foreignOrigin });

        expect(page.window).toBe(win);
        expect(page.frame).toBeUndefined();

        await page.disconnect();
    });

    it('reconnects after the page reloads, and old references reject', async () => {
        const events : Array<string> = [];

        const page = await connect<Basic>({
            url:          pageUrl({ scenario: 'basic' }),
            onDisconnect: ({ reason, reconnecting } : DisconnectInfo) => events.push(`disconnect:${ reason }:${ String(reconnecting) }`),
            onReconnect:  () => events.push('reconnect')
        });

        const { echo } = page.exports;

        await page.exports.reload();
        await waitFor({ check: () => events.includes('reconnect'), what: 'the reconnect', timeout: 8000 });

        expect(events).toEqual([ 'disconnect:navigated:true', 'reconnect' ]);
        await expect(echo('old')).rejects.toThrow('navigated away');
        expect(await page.exports.echo('new')).toBe('new');

        await page.disconnect();
    });

    it('gives up when the page navigates somewhere that never serves', async () => {
        const events : Array<string> = [];

        const page = await connect<Basic>({
            url:          pageUrl({ scenario: 'basic' }),
            timeout:      1500,
            onDisconnect: ({ reason } : DisconnectInfo) => events.push(reason)
        });

        await page.exports.leave();
        await waitFor({ check: () => events.includes('navigated'), what: 'the navigation' });

        await expect(page.updateProps({ name: 'x' })).rejects.toThrow('navigated away');
        await expect(page.getExports()).rejects.toThrow('navigated away');
        await waitFor({ check: () => events.includes('gone'), what: 'giving up', timeout: 8000 });

        expect(events).toEqual([ 'navigated', 'gone' ]);
        await expect(page.exports.echo('x')).rejects.toBeInstanceOf(DisconnectedError);
    });

    it('ends the connection when its frame leaves the page', async () => {
        const reasons : Array<string> = [];

        const page = await connect<Basic>({
            url:          pageUrl({ scenario: 'basic' }),
            onDisconnect: ({ reason } : DisconnectInfo) => reasons.push(reason)
        });

        page.frame?.remove();
        await waitFor({ check: () => reasons.length === 1, what: 'the close' });

        expect(reasons).toEqual([ 'closed' ]);
    });

    it('fails a connect whose frame is removed before the page answers', async () => {
        const connecting = connect({ url: pageUrl({ scenario: 'late' }) });

        await delay(50);
        document.querySelector('iframe')?.remove();

        await expect(connecting).rejects.toThrow('window closed');
    });

    it('reconnects without a give-up timer when timeout is 0', async () => {
        const events : Array<string> = [];

        const page = await connect<Basic>({
            url:         pageUrl({ scenario: 'basic' }),
            timeout:     0,
            onReconnect: () => events.push('reconnect')
        });

        await page.exports.reload();
        await waitFor({ check: () => events.includes('reconnect'), what: 'the reconnect', timeout: 8000 });

        await page.disconnect();
    });

    it('names an existing target in its timeout error', async () => {
        const frame = await loadFrame({ url: pageUrl({ scenario: 'none' }) });

        await expect(connect({ target: frame, domain: env.foreignOrigin, timeout: 300 })).rejects.toThrow(`from the given target`);
    });

    it('ignores an abort after it connected', async () => {
        const controller = new AbortController();
        const page = await connect<Basic>({ url: pageUrl({ scenario: 'basic' }), signal: controller.signal });

        controller.abort();

        expect(await page.exports.echo('still here')).toBe('still here');

        await page.disconnect();
    });

    it('turns an abort reason that is not an Error into one', async () => {
        const controller = new AbortController();
        const connecting = connect({ url: pageUrl({ scenario: 'none' }), signal: controller.signal });

        controller.abort('just a string');

        await expect(connecting).rejects.toThrow('just a string');
    });

    it('keeps two connections to one frame apart', async () => {
        const frame = await loadFrame({ url: pageUrl({ scenario: 'basic' }) });
        const first = await connect<Basic>({ target: frame, domain: env.foreignOrigin });
        const second = await connect<Basic>({ target: frame, domain: env.foreignOrigin });

        await first.disconnect();

        expect(await second.exports.echo('second')).toBe('second');

        await second.disconnect();
    });

    // Moving an iframe discards its window and makes a new one, so the
    // connection it had is over.
    it('ends the connection when its frame is moved in the page', async () => {
        const reasons : Array<string> = [];

        const page = await connect<Basic>({
            url:          pageUrl({ scenario: 'basic' }),
            onDisconnect: ({ reason } : DisconnectInfo) => reasons.push(reason)
        });

        const { frame } = page;

        if (!frame) {
            throw new Error('Expected a frame');
        }

        document.body.append(frame);
        await waitFor({ check: () => reasons.length === 1, what: 'the close' });

        expect(reasons).toEqual([ 'closed' ]);
    });

    it('ends for good when the reloaded page refuses to serve the caller', async () => {
        const events : Array<string> = [];

        const page = await connect<Basic>({
            url:          pageUrl({ scenario: 'refuseOnReload' }),
            onDisconnect: ({ reason } : DisconnectInfo) => events.push(reason)
        });

        await page.exports.reload();
        await waitFor({ check: () => events.includes('gone'), what: 'the end', timeout: 8000 });

        expect(events).toEqual([ 'navigated', 'gone' ]);
    });

    it('stays connected through a page hide into the back-forward cache', async () => {
        const page = await connect<Basic>({ url: pageUrl({ scenario: 'basic' }) });

        await page.exports.fakeHide({ persisted: true });
        await delay(150);

        expect(await page.exports.echo('cached')).toBe('cached');

        await page.disconnect();
    });

    it('treats a goodbye from a page that then never serves as navigating away', async () => {
        const events : Array<string> = [];

        const page = await connect<Basic>({
            url:          pageUrl({ scenario: 'basic' }),
            timeout:      500,
            onDisconnect: ({ reason } : DisconnectInfo) => events.push(reason)
        });

        await page.exports.fakeHide({ persisted: false });
        await waitFor({ check: () => events.includes('gone'), what: 'giving up', timeout: 5000 });

        expect(events).toEqual([ 'navigated', 'gone' ]);
    });
});
