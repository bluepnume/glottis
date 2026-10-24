// A small shop served over WebMCP, for the real-agent tests in run.ts. It
// is bundled for the browser and loaded in a cross-origin frame; the page's
// state is on window.__shop, so the runner can check what the agent did.

import { z } from 'zod';

import { serve, tool } from '../../src';

type Product = { readonly sku : string, readonly name : string, readonly price : number };

type Line = { readonly sku : string, quantity : number };

type Order = { readonly id : number, readonly lines : ReadonlyArray<Line>, readonly total : number };

type ShopState = {
    readonly carts : Array<Array<Line>>,
    readonly orders : Array<Order>,
    readonly wishlist : Array<string>,
    delivery : string | undefined,
    signedIn : string | undefined,
};

const CATALOG : ReadonlyArray<Product> = [
    { sku: 'red-mug', name: 'Red mug', price: 12 },
    { sku: 'blue-cup', name: 'Blue cup', price: 9 },
    { sku: 'green-mug', name: 'Green mug', price: 8 },
    { sku: 'tea-towel', name: 'Tea towel', price: 6 }
];

const SKUS = [ 'red-mug', 'blue-cup', 'green-mug', 'tea-towel' ] as const;

const state : ShopState = { carts: [], orders: [], wishlist: [], delivery: undefined, signedIn: undefined };

(window as unknown as { __shop : ShopState }).__shop = state;

let nextOrder = 1001;

const priceOf = (sku : string) : number => CATALOG.find(product => product.sku === sku)?.price ?? 0;

const isWeekday = (date : string) : boolean => {
    const day = new Date(`${ date }T12:00:00Z`).getUTCDay();

    return day >= 1 && day <= 5;
};

const openCart = tool({
    description: 'Open a new, empty shopping cart. Returns the cart, with tools to add to it and check it out.',

    handler: () => {
        const lines : Array<Line> = [];

        state.carts.push(lines);

        return {
            cartNumber: state.carts.length,
            items:      [],

            add: tool({
                description: 'Add a product to this cart',
                input:       z.object({ sku: z.enum(SKUS), quantity: z.number().int().min(1).max(10).default(1) }),

                handler: ({ sku, quantity } : { readonly sku : string, readonly quantity : number }) => {
                    const line = lines.find(candidate => candidate.sku === sku);

                    if (line) {
                        line.quantity += quantity;
                    } else {
                        lines.push({ sku, quantity });
                    }

                    return { items: lines.map(item => ({ ...item })) };
                }
            }),

            checkout: tool({
                description: 'Place an order for everything in this cart',
                annotations: { consequentialHint: true },
                once:        true,

                handler: () => {
                    if (lines.length === 0) {
                        throw new Error('This cart is empty; add something before checking out');
                    }

                    const order : Order = {
                        id:    nextOrder,
                        lines: lines.map(item => ({ ...item })),
                        total: lines.reduce((sum, item) => sum + (priceOf(item.sku) * item.quantity), 0)
                    };

                    nextOrder += 1;
                    state.orders.push(order);

                    return {
                        orderId: order.id,
                        total:   order.total,

                        trackOrder: tool({
                            description: 'Get the delivery status of this order',
                            annotations: { readOnlyHint: true },
                            handler:     () => ({ orderId: order.id, status: 'awaiting courier pickup' })
                        })
                    };
                }
            })
        };
    }
});

const search = tool({
    description: 'Search the catalogue by name. Each result has a tool to add it to the wishlist.',
    input:       z.object({ query: z.string() }),
    annotations: { readOnlyHint: true },

    handler: ({ query } : { readonly query : string }) => CATALOG
        .filter(product => product.name.toLowerCase().includes(query.toLowerCase()))
        .map(product => ({
            ...product,
            addToWishlist: tool({
                description: `Add ${ product.name } to the wishlist`,

                handler: () => {
                    state.wishlist.push(product.sku);

                    return { wishlist: [ ...state.wishlist ] };
                }
            })
        }))
});

const scheduleDelivery = tool({
    description: 'Choose the delivery date for orders, as YYYY-MM-DD',
    input:       z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine(isWeekday, 'Deliveries only run Monday to Friday, so this date is not available')
    }),

    handler: ({ date } : { readonly date : string }) => {
        state.delivery = date;

        return { date };
    }
});

const orderHistory = tool({
    description: 'List the signed-in customer\u2019s past orders',
    annotations: { readOnlyHint: true },
    handler:     () => ({ orders: [ { id: 901, total: 21 }, { id: 902, total: 6 }, { id: 903, total: 45 } ] })
});

const params = new URLSearchParams(location.search);

const signIn = tool({
    description: 'Sign in to the shop',
    input:       z.object({ email: z.email() }),

    handler: async ({ email } : { readonly email : string }) => {
        state.signedIn = email;
        // eslint-disable-next-line @typescript-eslint/no-use-before-define -- only called once serving
        await server.updateExports();

        return { signedIn: email };
    }
});

// Signing in swaps signIn for orderHistory, through updateExports().
const server = serve({
    clients: { webMcp: { allowed: true, domain: params.get('top') ?? '' } },

    exports: () => ({
        openCart,
        search,
        scheduleDelivery,
        ...state.signedIn === undefined
            ? { signIn }
            : { orderHistory }
    })
});
