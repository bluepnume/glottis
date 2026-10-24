import { connect } from '../src';

import { cleanFrames, pageUrl } from './common';

afterEach(() => {
    cleanFrames();
    document.querySelector('#container')?.remove();
});

const makeContainer = () : HTMLElement => {
    const container = document.createElement('div');

    container.id = 'container';
    document.body.append(container);

    return container;
};

describe('visible iframes', () => {
    it('renders into a container selector with the given attributes and style object', async () => {
        const container = makeContainer();

        const page = await connect({
            url:    pageUrl({ scenario: 'basic' }),
            target: {
                type:       'iframe',
                container:  '#container',
                attributes: {
                    class:           'checkout',
                    title:           'Checkout',
                    allowfullscreen: true,
                    hidden:          false,
                    style:           { height: 120, width: '100%', zIndex: 3, borderWidth: 0 }
                }
            }
        });

        const { frame } = page;

        expect(frame?.parentElement).toBe(container);
        expect(frame?.className).toBe('checkout');
        expect(frame?.title).toBe('Checkout');
        expect(frame?.hasAttribute('allowfullscreen')).toBe(true);
        expect(frame?.hasAttribute('hidden')).toBe(false);
        expect(frame?.style.height).toBe('120px');
        expect(frame?.style.zIndex).toBe('3');
        expect(frame?.style.borderWidth).toBe('0px');

        await page.disconnect();
        expect(container.children).toHaveLength(0);
    });

    it('takes a container element and a CSS string', async () => {
        const container = makeContainer();

        const page = await connect({
            url:    pageUrl({ scenario: 'basic' }),
            target: { type: 'iframe', container, attributes: { style: 'height: 50px' } }
        });

        expect(page.frame?.style.height).toBe('50px');

        await page.disconnect();
    });

    it('refuses a container selector that matches nothing', async () => {
        await expect(connect({ url: pageUrl({ scenario: `basic` }), target: { type: `iframe`, container: `#missing` } }))
            .rejects.toThrow('No element matches container "#missing"');
    });

    it('needs a url to open', async () => {
        await expect(connect({ target: { type: 'iframe' } })).rejects.toThrow('needs a `url`');
    });

    it('refuses an iframe that is not in the page', async () => {
        await expect(connect({ target: document.createElement(`iframe`), domain: `*` })).rejects.toThrow(`not in the page`);
    });
});
