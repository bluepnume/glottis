import { connect } from '../src';

import { cleanFrames, pageUrl } from './common';

type Described = {
    readonly cart : { readonly add : (args : { readonly id : unknown, readonly quantity ?: number }) => string },
    readonly plain : (args : { readonly id : unknown }) => unknown,
    readonly custom : (value : unknown) => string,
    readonly confirm : () => string,
    readonly undescribed : () => string,
};

const url = pageUrl({ scenario: 'described' });

afterEach(cleanFrames);

describe('described functions', () => {
    it('validates arguments with a Standard Schema and applies its defaults', async () => {
        const page = await connect<Described>({ url });

        expect(await page.exports.cart.add({ id: 'sku' })).toBe('sku x1');
        await expect(page.exports.cart.add({ id: 42 })).rejects.toThrow('Invalid input: id: Invalid input');

        await page.disconnect();
    });

    it('puts descriptions and JSON Schema from zod in the manifest', async () => {
        const page = await connect<Described>({ url });
        const add = page.manifest.functions['cart.add'];

        expect(add?.description).toBe('Add a product to the cart');
        expect(add?.input).toMatchObject({ type: 'object', required: [ 'id' ] });
        expect(add?.output).toMatchObject({ type: 'string' });

        await page.disconnect();
    });

    it('treats plain JSON Schema as metadata only', async () => {
        const page = await connect<Described>({ url });

        expect(await page.exports.plain({ id: 123 })).toBe(123);
        expect(page.manifest.functions.plain?.input).toMatchObject({ type: 'object' });

        await page.disconnect();
    });

    it('validates with any Standard Schema and takes its JSON Schema from jsonSchema', async () => {
        const page = await connect<Described>({ url });

        expect(await page.exports.custom('quiet')).toBe('QUIET');
        await expect(page.exports.custom(5)).rejects.toThrow('Invalid input for shout: value: expected a string');
        expect(page.manifest.functions.custom?.input).toEqual({ type: 'string' });

        await page.disconnect();
    });

    it('leaves out JSON Schema a validator fails to produce', async () => {
        const page = await connect<Described & { readonly broken : (value : unknown) => unknown }>({ url });

        expect(page.manifest.functions.broken).toEqual({});
        expect(await page.exports.broken('fine')).toBe('fine');

        await page.disconnect();
    });

    it('releases a once function after its first call', async () => {
        const page = await connect<Described>({ url });

        expect(page.manifest.functions.confirm?.once).toBe(true);
        expect(await page.exports.confirm()).toBe('confirmed');
        await expect(page.exports.confirm()).rejects.toThrow();

        await page.disconnect();
    });

    it('lists functions with no description too', async () => {
        const page = await connect<Described>({ url });

        expect(page.manifest.functions.undescribed).toEqual({});
        expect(await page.exports.undescribed()).toBe('plain function');

        await page.disconnect();
    });
});
