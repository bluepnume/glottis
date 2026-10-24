# glottis

Give a web page a public client API. A page calls `serve()` with some functions, and any other page, frame, popup or in-page script calls `connect()` and uses them as if they were local. Functions travel by reference in both directions, so you can pass callbacks and return objects full of live methods.

The glottis is the opening your voice comes out of. A page that calls `serve()` opens one, and other pages can talk to it.

```js
// On https://shop.example/api, the page being called
import { serve } from 'glottis';

serve({
    domain:  '*',
    exports: {
        hello: ({ name }) => {
            // This runs here, inside the child frame showing shop.example,
            // not on the parent page that called it.
            console.log(`Hello, ${ name }!`);
        }
    }
});
```

```js
// On any other site
import { connect } from 'glottis';

const shop = await connect({ url: 'https://shop.example/api' });

await shop.exports.hello({ name: 'Ada' });   // logs 'Hello, Ada!' in the shop.example frame
```

Functions can return things too, including things only the frame can see. Here the page shares what is in its own `localStorage`, which no other site could read directly:

```js
// On https://shop.example/api
serve({
    domain:  '*',
    exports: {
        getRecentlyViewed: () => JSON.parse(localStorage.getItem('recentlyViewed') ?? '[]')
    }
});
```

```js
// On any other site
const viewed = await shop.exports.getRecentlyViewed();   // [{ id: 'socks', name: 'Wool socks' }, ...]
```

That is the whole idea. Everything below builds on these two calls, one step at a time.

- [Install](#install)
- [The basics](#the-basics)
- [What crosses the boundary](#what-crosses-the-boundary)
- [Who may connect](#who-may-connect)
- [Props](#props)
- [Exports per connection](#exports-per-connection)
- [Describing functions](#describing-functions)
- [Changing exports while connected](#changing-exports-while-connected)
- [Where the page runs](#where-the-page-runs)
- [The connection lifecycle](#the-connection-lifecycle)
- [Several services on one page](#several-services-on-one-page)
- [Callers on the same page](#callers-on-the-same-page)
- [TypeScript](#typescript)
- [Deploying a serving page](#deploying-a-serving-page)
- [Compared with other libraries](#compared-with-other-libraries)
- [API reference](#api-reference)
- [How it works](#how-it-works)

## Install

```sh
npm install glottis
```

Or, on a page without a bundler, load the script-tag build. It defines `window.glottis`:

```html
<script src="https://unpkg.com/glottis/dist/glottis.min.js"></script>
<script>
    window.glottis.serve({ domain: '*', exports: { ping: () => 'pong' } });
</script>
```

glottis supports current versions of Chrome, Edge, Firefox and Safari.

## The basics

### Serving

`serve()` takes the functions your page offers, under `exports`, and the origins allowed to call them, under `domain`:

```js
serve({
    domain:  'https://partner.example',
    exports: {
        add: ({ a, b }) => a + b
    }
});
```

Exports can be grouped into plain objects, as deep as you like, and can include constants:

```js
serve({
    domain:  '*',
    exports: {
        version: '2.1',
        cart: {
            get: () => getCart(),
            add: ({ id }) => addToCart(id)
        },
        buyNow: () => checkout()
    }
});
```

### Connecting

`connect()` opens the page in a hidden iframe, waits for it to serve, and resolves with a connection:

```js
const shop = await connect({ url: 'https://shop.example/api' });

shop.exports.version;              // '2.1', available at once
await shop.exports.cart.get();     // every function returns a promise
await shop.exports.buyNow();
```

Constants are there as soon as `connect` resolves. Functions always return promises, because the call runs in another window.

### Disconnecting

```js
await shop.disconnect();
```

This removes the hidden iframe and releases everything the connection held. Calling an export afterwards rejects with a `DisconnectedError`.

## What crosses the boundary

glottis has one rule: **data is copied, functions are live.**

- **Plain data** (objects, arrays, strings, numbers, booleans, `null`, `undefined`, `Date`, `RegExp`) is copied. Changing a copy changes nothing on the other side.
- **Functions** go by reference. The other side gets a function that calls the original in its own window and resolves with the result.
- **Promises** go by reference too, and settle when the original does.
- **Errors** thrown on one side reject the call on the other, with their name and message intact.
- **Windows** passed or returned arrive as a post-robot `ProxyWindow`, which you can message or pass on.

Because functions travel both ways, you can pass callbacks:

```js
// page
serve({
    domain:  '*',
    exports: { countdown: async ({ from, onTick }) => {
        for (let i = from; i > 0; i--) {
            await onTick(i);
        }
    } }
});

// caller
await shop.exports.countdown({ from: 3, onTick: n => console.log(n) });
```

And you can return objects whose methods stay live, which keeps APIs object-shaped instead of passing ids around:

```js
// page
serve({
    domain:  '*',
    exports: {
        cart: () => {
            const items = [];

            return {
                add:      item => items.push(item),
                getItems: () => items
            };
        }
    }
});

// caller
const cart = await shop.exports.cart();

await cart.add({ id: 'socks' });
await cart.getItems();   // [{ id: 'socks' }]
```

Anything that changes over time should be a function. A plain property is a snapshot from the moment it was sent:

```js
cart.items;               // the items when cart() returned
await cart.getItems();    // the items now
```

### Subscriptions

There is no event system to learn: a subscription is a function that takes a callback and returns a function to stop it.

```js
// page
watchPrice: ({ id, onChange }) => {
    const stop = prices.subscribe(id, onChange);

    return stop;
}

// caller
const stop = await shop.exports.watchPrice({ id: 'socks', onChange: price => render(price) });

await stop();
```

### How long references live

You never have to release anything by hand. A function reference is released when the side holding it lets go of it and the browser collects it, or when the connection ends, whichever comes first. A function that should only ever be called once can say so, see [`once`](#once).

## Who may connect

`domain` is required on `serve()`, so making a page public is always a deliberate choice you can see in the code. It takes:

```js
serve({ domain: 'https://chatgpt.com', exports });                      // one origin
serve({ domain: [ 'https://a.example', 'https://b.example' ], exports }); // several
serve({ domain: /^https:\/\/([a-z]+\.)?partner\.example$/, exports });     // a pattern
serve({ domain: async ({ origin }) => allowlist.includes(origin), exports }); // you decide, sync or async
serve({ domain: '*', exports });                                        // anyone
```

A caller that is refused gets a `DomainError` from `connect()`.

The caller checks the other direction automatically. When you connect by `url`, glottis only talks to a page at that URL's origin. You can widen or replace that check with the same `domain` option on `connect()`.

## Props

The caller can pass data and functions to the page with `props`, and change them later:

```js
const shop = await connect({
    url:   'https://shop.example/api',
    props: { locale: 'en-GB', onOrder: order => notify(order) }
});

await shop.updateProps({ locale: 'fr-FR' });   // merged into the current props
```

The page reads props through the per-connection form of `exports`, described next.

## Exports per connection

`exports` can also be a function. glottis calls it once for every connection, with what it knows about the caller:

```js
serve({
    domain:  '*',
    exports: ({ origin, props, onProps, getProps, window }) => {
        let locale = props.locale;

        onProps(next => {
            locale = next.locale;              // after every updateProps
        });

        return {
            greet: () => greeting(locale),
            // only partners even see this export
            ...origin === 'https://partner.example' ? { refund } : {}
        };
    }
});
```

The function can be async, to wait for something before the caller is answered. What it receives:

| Field | What it is |
| --- | --- |
| `origin` | The caller's origin. |
| `window` | The caller's window, as a `ProxyWindow`. |
| `props` | The caller's props, validated if you gave a [`props` schema](#a-props-schema). |
| `onProps(handler)` | Calls `handler` with the merged props after every `updateProps`. Returns `{ cancel }`. |
| `getProps()` | Asks the caller for its latest props. |

Every connection gets its own run of this function, so each caller has its own state, even when the same caller connects twice.

## Describing functions

`describe.function()` adds a description and schemas to a function. The description shows up in the [manifest](#the-manifest) and the schemas validate arguments before your function runs:

```js
import { z } from 'zod';
import { describe, serve } from 'glottis';

serve({
    domain:  '*',
    exports: {
        cart: {
            add: describe.function({
                description: 'Add a product to the cart',
                input:       z.object({ id: z.string(), quantity: z.number().int().min(1).default(1) }),
                handler:     ({ id, quantity }) => addToCart({ id, quantity })
            })
        }
    }
});
```

A call with bad arguments now rejects with a `ValidationError` before reaching `addToCart`:

```js
await shop.exports.cart.add({ id: 42 });
// ValidationError: Invalid input: id: Invalid input: expected string, received number
```

The handler receives the validated value, with defaults applied.

### Schemas

`input` and `output` accept any [Standard Schema](https://standardschema.dev) validator, such as zod, valibot or arktype. glottis does not depend on any of them.

- **Validators that can describe themselves as JSON Schema** (zod 4 can) put that JSON Schema in the manifest automatically.
- **Other validators** still validate. Pass `jsonSchema: { input, output }` if you want JSON Schema in the manifest too.
- **Plain JSON Schema objects** are accepted as documentation only; they do not validate.

```js
describe.function({
    handler:    ({ id }) => lookup(id),
    input:      { type: 'object', properties: { id: { type: 'string' } }, required: [ 'id' ] }
});
```

`describe.function()` works on any function, including ones you return from other calls, so the methods of a returned object can be described too.

### once

A function marked `once: true` is released after its first call. Calling it again rejects:

```js
confirm: describe.function({ handler: () => placeOrder(), once: true })
```

### The manifest

Every connection carries a manifest listing every function the page exports, by dotted path, with whatever was described:

```js
shop.manifest;
// {
//     service:   'default',
//     protocol:  1,
//     functions: {
//         'cart.add': { description: 'Add a product to the cart', input: { type: 'object', ... } }
//     }
// }
```

Give the whole service a description with `serve({ description })`.

### A props schema

`serve({ props })` validates the caller's props, at connect and on every `updateProps`, with the same schema rules:

```js
serve({
    domain:  '*',
    props:   z.object({ locale: z.string().default('en-US') }),
    exports: ({ props }) => ({ locale: props.locale })
});
```

Invalid props make `connect()` or `updateProps()` reject with a `ValidationError`, and the page keeps the previous props.

## Changing exports while connected

`serve()` returns a server with two methods.

`updateExports()` rebuilds every connection's exports and pushes them to the callers. Pass new exports to replace them, or nothing to re-run the per-connection function:

```js
const server = serve({
    domain:  '*',
    exports: () => (user ? { cart, buyNow } : { signIn })
});

auth.onChange(() => server.updateExports());
```

On the caller, `connection.exports` changes and `onExportsChange` is called. References the caller already holds keep working. A caller can also pull the latest exports with `await connection.getExports()`.

`stop()` ends every connection and stops answering new ones. Callers see `onDisconnect` with the reason `'stopped'`.

## Where the page runs

By default `connect()` opens the page in a hidden iframe. `target` chooses something else.

### A visible iframe

```js
await connect({
    url,
    target: {
        type:       'iframe',
        container:  '#checkout',                  // a selector or an element
        attributes: {
            class: 'checkout-frame',
            title: 'Checkout',
            allow: 'payment; publickey-credentials-get',
            style: { width: '100%', height: 400, border: 0 }   // or a CSS string
        }
    }
});
```

Any iframe attribute can go in `attributes`. Numbers in a style object mean pixels, except for unitless properties such as `zIndex` and `opacity`. The iframe is available as `connection.frame`, so you can style, move or hide it yourself.

### A popup

```js
button.addEventListener('click', async () => {
    const shop = await connect({ url, target: { type: 'popup', width: 500, height: 700 } });
});
```

Browsers only open popups during a click, and glottis opens the window as its very first step, so call `connect()` directly in the click handler, before any `await`. glottis closes the popup on disconnect, and ends the connection if the user closes it.

### A frame or window you already have

```js
await connect({ target: document.querySelector('iframe'), domain: 'https://shop.example' });
await connect({ target: someWindow, domain: 'https://shop.example' });
```

There is no URL to check against, so `domain` is required. glottis never removes a frame or window it did not create.

## The connection lifecycle

### Waiting and giving up

`connect()` waits up to 10 seconds for the page to serve. Change that with `timeout` (in milliseconds, `0` waits forever), or cancel with an `AbortSignal`:

```js
const controller = new AbortController();

connect({ url, timeout: 30_000, signal: controller.signal });
controller.abort();
```

When it gives up, it rejects with a `ConnectTimeoutError` naming the likely causes, and removes anything it created.

### Events

```js
await connect({
    url,
    onExportsChange: ({ exports, manifest }) => {},
    onDisconnect:    ({ reason, reconnecting }) => {},
    onReconnect:     ({ exports, manifest }) => {}
});
```

| `reason` | When |
| --- | --- |
| `'disconnected'` | The caller called `disconnect()`. |
| `'stopped'` | The page called `stop()`. |
| `'closed'` | The frame or popup closed, or the iframe left the page. Moving an iframe in the DOM counts, because the browser gives the moved iframe a new window. |
| `'navigated'` | The page navigated or reloaded. `reconnecting` is `true`. |
| `'gone'` | The page navigated and did not serve again before the timeout. |

### Navigation and reloads

When the page in the frame navigates or reloads, the connection survives. glottis reports `onDisconnect({ reason: 'navigated', reconnecting: true })`, waits for the new page to serve the same service, connects again with the current props, and reports `onReconnect`. This matters for sign-in flows, which usually navigate the frame.

References from the old page reject with a `DisconnectedError`, because the functions they pointed at are gone. Take fresh ones from `connection.exports` after `onReconnect`.

If the new page does not serve within the timeout, the connection ends with `'gone'`.

## Several services on one page

A page can serve more than one API, each under its own name:

```js
serve({ domain: '*', service: 'checkout', exports: checkoutApi });
serve({ domain: '*', exports: mainApi });   // the 'default' service

await connect({ url, service: 'checkout' });
```

Serving the same name twice on one page throws.

## Callers on the same page

A serving page also gets `window.glottis.connect()`, so other code in the page, browser extensions running in the page's main world, and browser automation agents can use its API without a frame:

```js
const page = await window.glottis.connect();                       // the default service
const checkout = await window.glottis.connect({ service: 'checkout' });
```

These connections behave exactly like remote ones. Data is copied and functions are references, so code that works here works across frames too.

Content scripts in an extension's isolated world cannot see the page's globals, so they cannot use this yet.

## TypeScript

Pages can publish the type of their exports, and callers can use it:

```ts
// page
import type { ExportsOf } from 'glottis';

const exports = { add: ({ a, b } : { a : number, b : number }) => a + b };

serve({ domain: '*', exports });

export type ShopApi = ExportsOf<typeof exports>;
```

```ts
// caller
import type { ShopApi } from 'shop-api-types';

const shop = await connect<ShopApi>({ url });

await shop.exports.add({ a: 1, b: 2 });   // Promise<number>
```

`ExportsOf` also unwraps a per-connection `exports` function. `Remote<T>` is the mapping from a local type to how it looks across the boundary.

## Deploying a serving page

### Let it be framed

Most sites tell browsers not to let other sites frame them, with `X-Frame-Options` or a `frame-ancestors` Content Security Policy. A page that sends those cannot load in a caller's iframe, and the caller cannot see why: the frame shows an error page, and `connect()` times out.

Serve your API from a small, dedicated page, such as `https://shop.example/api`, that does nothing but call `serve()`, and send a `frame-ancestors` header listing the same origins as your `domain`:

```
Content-Security-Policy: frame-ancestors https://chatgpt.com https://partner.example
```

Popups are not affected by framing rules.

### Signed-in state and third-party cookies

Inside another site, your page is a third party, and browsers restrict its cookies:

- Cookies with `SameSite=Lax`, the default, are never sent to a cross-site iframe.
- Safari blocks third-party cookies entirely, and Firefox partitions them per embedding site.

So by default your page will look signed out inside a frame. Two things work:

- **A popup** is a top-level window with normal cookies. Use `target: { type: 'popup' }` for anything that needs the user's existing session.
- **The Storage Access API.** Inside the frame, `document.requestStorageAccess()` grants your real cookies after a click in the frame.

It helps callers if your exports say which state they got, for example a `signedIn` constant.

### Popups and Cross-Origin-Opener-Policy

If either page sends `Cross-Origin-Opener-Policy: same-origin`, the browser cuts the link between a popup and its opener, and they cannot talk at all. Pages used through popups need to allow it, for example with `same-origin-allow-popups` on the opener.

## Compared with other libraries

Plenty of libraries help windows talk to each other. Here is how glottis relates to the ones you are most likely to be weighing it against.

**[zoid](https://github.com/bluepnume/zoid)** renders cross-domain components. Both sides load a shared component definition, and zoid handles the iframe or popup, its size, a prerender, props and the component's lifecycle. Use zoid when what you are embedding is a component. Use glottis when what you want from the other page is an API: there is no definition to publish, the caller discovers what the page exports, and the page can run hidden. The two fit together, since a zoid component's exports can be built on glottis.

**[post-robot](https://github.com/bluepnume/post-robot)** is the messaging layer glottis runs on. It sends named messages between windows and passes functions by reference. Use it directly if you want raw messages. Use glottis when you want the parts around them: opening the frame or popup, the handshake, the manifest, props, reconnecting after navigation, and validation.

**[Penpal](https://github.com/Aaronius/penpal)** is the closest in spirit: a handshake, then a proxy of the methods the other side offers. You create and manage the iframe yourself, arguments and results are copied as data so you cannot pass a callback, and there is no list of what the other side offers until a call fails. glottis opens the frame for you, passes functions both ways, and tells you what is exported up front.

**[Comlink](https://github.com/GoogleChromeLabs/comlink)** makes a worker or another window look like a local object. It is excellent for Web Workers. Functions only cross when you wrap them with `Comlink.proxy()`, and references stay alive until you release them by hand. It has no handshake for frames, does not open them, and has no origin policy of its own. glottis is built for pages on other origins, passes every function by reference without wrapping, and releases references when they are collected.

**[Postmate](https://github.com/dollarshaveclub/postmate)** connects a parent to a child iframe and lets the parent read values and call methods. It cannot pass functions, and it has not had a release in years.

**[Cap'n Web](https://github.com/cloudflare/capnweb)** is Cloudflare's object-capability RPC. It goes further than glottis in some ways: promise pipelining sends a chain of dependent calls in one round trip, and it runs over HTTP and WebSockets as well as `postMessage`. It is built for those transports, and asks you to dispose of every reference explicitly. It does not open frames, discover services, or check origins for you. glottis keeps a simpler model, where data is copied and functions are live, and does the frame handling for you.

**[WebMCP](https://github.com/webmachinelearning/webmcp)**, and its polyfill [MCP-B](https://github.com/WebMCP-org/npm-packages), let a page register tools for AI agents. Tools take JSON and return a string, with no function references, because the caller is a model. glottis is for code calling code, where callbacks and live objects matter. Projecting glottis's described exports as WebMCP tools is on the roadmap.

**Plain `postMessage`** is what all of these wrap. It is enough for a message or two. glottis is worth it once you would otherwise be writing request ids, origin checks, timeouts and callback plumbing yourself.

### When to use glottis

- **You want an API from another page, not a component.** A site offers functions, and other sites call them, with no definition for both sides to share.
- **You want callbacks and live objects across origins.** Pass `onChange` handlers, return a cart and call its methods.
- **Callers should discover what is available.** Every connection carries a manifest of the page's functions, with descriptions and schemas.
- **The page should look after itself.** Who may connect, what props it accepts, and which arguments are valid all live on the serving page.

## API reference

### `serve(options)`

| Option | Type | |
| --- | --- | --- |
| `domain` | string, RegExp, array, or `({ origin }) => boolean \| Promise<boolean>` | Required. Who may connect. |
| `exports` | object, or `(context) => object \| Promise<object>` | Required. What the page offers. |
| `service` | string | The service name. Defaults to `'default'`. |
| `description` | string | Describes the service in the manifest. |
| `props` | schema | Validates the caller's props. |
| `onConnect` | `({ origin, window }) => void` | A caller connected. |
| `onDisconnect` | `({ origin, window, reason }) => void` | A caller's connection ended. |

Returns `{ stop(), updateExports(exports?) }`.

### `connect(options)`

| Option | Type | |
| --- | --- | --- |
| `url` | string | The page to open. |
| `target` | `{ type: 'iframe', container?, attributes? }`, `{ type: 'popup', width?, height? }`, an iframe, or a window | Where the page runs. Defaults to a hidden iframe. |
| `domain` | same as `serve` | The origins the page may be at. Defaults to the URL's origin; required for an existing frame or window. |
| `service` | string | Which service to connect to. Defaults to `'default'`. |
| `props` | object | Data and functions for the page. |
| `timeout` | number | Milliseconds to wait. Defaults to `10000`; `0` waits forever. |
| `signal` | `AbortSignal` | Cancels the connect. |
| `onExportsChange`, `onDisconnect`, `onReconnect` | functions | See [Events](#events). |

Leave out both `url` and `target` to connect to a service on the current page.

Resolves with a connection:

| Member | |
| --- | --- |
| `exports` | The page's exports. |
| `manifest` | The page's manifest. |
| `service`, `origin` | Which service, and the page's origin. |
| `window`, `frame` | The window on the other side, and its iframe if there is one. |
| `updateProps(partial)` | Merges and sends new props. |
| `getExports()` | Pulls the page's current exports. |
| `disconnect()` | Ends the connection. |

### `describe.function(options)`

| Option | |
| --- | --- |
| `handler` | Required. The function. |
| `description` | A sentence about what it does. |
| `input`, `output` | Schemas for the first argument and the result. |
| `jsonSchema` | `{ input?, output? }` JSON Schema for the manifest, for validators that cannot produce it. |
| `once` | Release after the first call. |

### Errors

| Error | When |
| --- | --- |
| `ConnectTimeoutError` | `connect()` heard nothing in time. |
| `DomainError` | The page refused the caller's origin. |
| `ValidationError` | Arguments or props failed their schema. Its `issues` lists what was wrong. |
| `DisconnectedError` | A call on an ended connection or a stale reference. Its `reason` says why. |

## How it works

glottis runs on [post-robot](https://github.com/bluepnume/post-robot), which carries messages between windows, and [sandestin](https://github.com/bluepnume/sandestin), which turns functions and promises into references that call home.

1. When a page calls `serve()`, it announces its services to the window that framed or opened it.
2. `connect()` listens for that announcement, checks the page's origin, and sends a connect request with the service name and props.
3. The page checks the caller's origin, builds the exports, and answers with them and the manifest.
4. A frame that loaded before `connect()` was called is asked once to announce again.

The script-tag build is about 56 KB minified and 19 KB gzipped, most of it post-robot. With a bundler, a page that only calls `serve()` leaves out the code for opening frames and popups.

### Not yet

- Cancelling a call already in progress with an `AbortSignal`.
- Exposing exports to AI agents through the browser's WebMCP API.
- Callers in an extension's isolated world.
- Version negotiation between different releases of glottis.

## License

MIT
