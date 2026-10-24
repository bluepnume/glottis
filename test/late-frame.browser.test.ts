// A frame that loaded, and whose page loaded glottis, before this page ever
// used glottis or post-robot: the frame's hello went to nobody. This file
// loads its frames first and only then calls connect().
import { connect } from '../src';

import { cleanFrames, delay, env, pageUrl } from './common';

const loadFrameQuietly = async (url : string) : Promise<HTMLIFrameElement> => {
    const frame = document.createElement('iframe');

    frame.src = url;
    document.body.append(frame);

    await new Promise(resolve => {
        frame.addEventListener('load', resolve, { once: true });
    });

    // Long enough for the frame's own hello and announce to come and go.
    await delay(300);

    return frame;
};

afterEach(cleanFrames);

describe('a frame that loaded before this page used glottis', () => {
    it('connects to a page that already served', async () => {
        const frame = await loadFrameQuietly(pageUrl({ scenario: 'basic' }));
        const options = { target: frame, domain: env.foreignOrigin, timeout: 4000 };
        const page = await connect<{ readonly version : string }>(options);

        expect(page.exports.version).toBe('1.0');

        await page.disconnect();
    });

    it('connects to a page that serves after connect() was called', async () => {
        const frame = await loadFrameQuietly(pageUrl({ scenario: 'late' }));
        const options = { target: frame, domain: env.foreignOrigin, timeout: 4000 };
        const page = await connect<{ readonly late : () => string }>(options);

        expect(await page.exports.late()).toBe('served late');

        await page.disconnect();
    });
});
