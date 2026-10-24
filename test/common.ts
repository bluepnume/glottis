// Helpers every browser suite shares.

import { collectChildCoverage } from './coverage';
import { getTestEnv } from './env';

collectChildCoverage();

export const env = getTestEnv();

type PageUrlOptions = {
    readonly scenario : string,
    readonly origin ?: string,
    readonly page ?: string,
};

// A serving test page running one scenario from test/scenarios.ts.
export const pageUrl = ({ scenario, origin = env.foreignOrigin, page = 'serve' } : PageUrlOptions) : string =>
    `${ origin }/test/pages/${ page }.html?scenario=${ scenario }&parent=${ encodeURIComponent(env.origin) }`;

type WaitForOptions = {
    readonly check : () => boolean,
    readonly timeout ?: number,
    readonly what ?: string,
};

export const waitFor = async ({ check, timeout = 5000, what = 'condition' } : WaitForOptions) : Promise<void> => {
    const deadline = Date.now() + timeout;

    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${ what }`);
        }

        // eslint-disable-next-line no-await-in-loop -- polling
        await new Promise(resolve => {
            setTimeout(resolve, 20);
        });
    }
};

export const delay = (ms : number) : Promise<void> => new Promise(resolve => {
    setTimeout(resolve, ms);
});

// Every frame the suite added, removed between tests.
export const cleanFrames = () : void => {
    for (const frame of document.querySelectorAll('iframe')) {
        frame.remove();
    }
};

type LoadFrameOptions = {
    readonly url : string,
};

export const loadFrame = async ({ url } : LoadFrameOptions) : Promise<HTMLIFrameElement> => {
    const frame = document.createElement('iframe');

    frame.src = url;
    document.body.append(frame);

    await new Promise(resolve => {
        frame.addEventListener('load', resolve, { once: true });
    });

    return frame;
};
