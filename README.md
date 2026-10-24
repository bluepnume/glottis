# glottis

Give a web page a public client API. A page calls `serve()` with some functions, and any other page, frame, popup or in-page script calls `connect()` and uses them as if they were local. Functions travel by reference in both directions, so you can pass callbacks and return objects full of live methods.

The glottis is the opening your voice comes out of. A page that calls `serve()` opens one, and other pages can talk to it.

```js
// On https://shop.example/api, the page being called
import { serve } from 'glottis';

serve({
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
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
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
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
    window.glottis.serve({ clients: { remoteWindow: { allowed: true, domain: '*' } }, exports: { ping: () => 'pong' } });
</script>
```

glottis supports current versions of Chrome, Edge, Firefox and Safari.

## The basics

### Serving

`serve()` takes the functions your page offers, under `exports`, and who may call them, under `clients`:

```js
serve({
    clients:  { remoteWindow: { allowed: true, domain: 'https://partner.example' } },
    exports: {
        add: ({ a, b }) => a + b
    }
});
```

Exports can be grouped into plain objects, as deep as you like, and can include constants:

```js
serve({
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
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
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
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
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
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

`clients` decides which kinds of caller may connect, and from where:

```js
serve({
    exports,
    clients: {
        remoteWindow: { allowed: true, domain: 'https://chatgpt.com' },   // other windows
        localWindow:  { allowed: true },                                  // scripts on this page
        webMcp:       { allowed: true }                                   // AI agents
    }
});
```

- **`remoteWindow`** covers other windows: frames, popups, the window that opened this page, and anything further up the frame tree. It is off until you allow it, and allowing it needs a `domain`, so making a page public is always a deliberate choice you can see in the code.
- **`localWindow`** covers scripts on this same page, see [Callers on the same page](#callers-on-the-same-page). It is on unless you turn it off. A page whose services all turn it off has no `window.glottis`.
- **`webMcp`** covers AI agents, through the browser's WebMCP API, see [AI agents](#ai-agents-webmcp). It is off until you allow it.

Kinds of caller added in future versions will be off until you allow them, so upgrading never exposes a page to callers it did not choose.

`domain` takes:

```js
domain: 'https://chatgpt.com'                                   // one origin
domain: [ 'https://a.example', 'https://b.example' ]            // several
domain: /^https:\/\/([a-z]+\.)?partner\.example$/                // a pattern
domain: async ({ origin }) => allowlist.includes(origin)        // you decide, sync or async
domain: '*'                                                     // anyone
```

A caller whose origin is refused gets a `DomainError` from `connect()`. A kind of caller the service does not allow gets a `ClientNotAllowedError`.

The caller checks the other direction automatically. When you connect by `url`, glottis only talks to a page at that URL's origin. You can widen or replace that check with a `domain` option on `connect()`, which takes the same forms.

### Asking the user first

`clients` decides which sites may connect. To also ask the user before a site gets in, make `exports` an async function and wait for their answer there. The caller is not answered until it returns:

```js
serve({
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
    exports: async ({ client }) => {
        // Your own dialog, shown inside this page.
        const allowed = await askUser(`Let ${ client.origin } see your recently viewed items?`);

        if (!allowed) {
            throw new Error('The user declined');
        }

        return { getRecentlyViewed };
    }
});
```

If the user agrees, `connect()` resolves with the exports. If they decline, `connect()` rejects with your error, message and all:

```js
try {
    const shop = await connect({ url, target: { type: 'popup' } });
} catch (err) {
    err.message;   // 'The user declined'
}
```

A few things to get right:

- **The user has to be able to see the question.** The default hidden iframe cannot show a dialog, so a page that asks needs callers to connect with a visible iframe (`target: { type: 'iframe', container }`) or a popup. Say so in your docs.
- **There is no timeout to worry about.** `connect()`'s timeout only covers finding a page that serves. Once yours has announced itself, the caller waits for your answer however long the user takes.
- **Remember the answer.** Store the user's choice per origin, for example in `localStorage`, and skip the question next time, so returning callers connect at once.
- **Ask per connection, not per page.** The function runs for every connection, so each new caller is asked, and a caller the user allowed does not open the door for anyone else.

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
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
    exports: ({ client, props, onProps }) => {
        let locale = props.locale;

        onProps(next => {
            locale = next.locale;              // after every updateProps
        });

        return {
            greet: () => greeting(locale),
            // only partners even see this export
            ...client.origin === 'https://partner.example' ? { refund } : {}
        };
    }
});
```

The function can be async, to wait for something before the caller is answered. What it receives:

| Field | What it is |
| --- | --- |
| `client` | Who is connecting. `client.type` is a `CLIENT_TYPE`: `REMOTE_WINDOW` and `LOCAL_WINDOW` come with the caller's `origin` and its `window` (a `ProxyWindow`); `WEB_MCP` is the run for [AI agents](#ai-agents-webmcp), with neither. |
| `props` | The caller's props, validated if you gave a [`props` schema](#a-props-schema). |
| `onProps(handler)` | Calls `handler` with the merged props after every `updateProps`. Returns `{ cancel }`. |
| `getProps()` | Asks the caller for its latest props. |

Every connection gets its own run of this function, so each caller has its own state, even when the same caller connects twice.

In TypeScript, check `client.type` before reading `client.origin`, since WebMCP has no origin:

```ts
exports: ({ client }) => client.type === CLIENT_TYPE.REMOTE_WINDOW && client.origin === 'https://partner.example'
    ? { greet, refund }
    : { greet }
```

## Describing functions

`tool()` adds a description and schemas to a function. The description shows up in the [manifest](#the-manifest) and the schemas validate arguments before your function runs. Functions made with `tool()` are also the ones [AI agents](#ai-agents-webmcp) can use, if you let them:

```js
import { z } from 'zod';
import { serve, tool } from 'glottis';

serve({
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
    exports: {
        cart: {
            add: tool({
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
tool({
    handler:    ({ id }) => lookup(id),
    input:      { type: 'object', properties: { id: { type: 'string' } }, required: [ 'id' ] }
});
```

`tool()` works on any function, including ones you return from other calls, so the methods of a returned object can be described too.

Before 0.3, `tool()` was called `describe.function()`. That name still works, and goes in the next release.

### once

A function marked `once: true` is released after its first call. Calling it again rejects:

```js
confirm: tool({ handler: () => placeOrder(), once: true })
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
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
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
    clients:  { remoteWindow: { allowed: true, domain: '*' } },
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

The timeout only covers finding a page that serves. Once the page has announced itself, `connect()` waits for its answer for as long as the page takes, so a page that [asks its user first](#asking-the-user-first) is never cut off. Use a `signal` if the caller wants to stop waiting.

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
serve({ clients: { remoteWindow: { allowed: true, domain: '*' } }, service: 'checkout', exports: checkoutApi });
serve({ clients: { remoteWindow: { allowed: true, domain: '*' } }, exports: mainApi });   // the 'default' service

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

To keep a service away from scripts on the page, serve it with `clients: { localWindow: { allowed: false } }`. If no service on the page allows them, `window.glottis` is not installed at all.

## AI agents (WebMCP)

> Experimental. [WebMCP](https://github.com/webmachinelearning/webmcp) is a draft browser API, and the `webMcp` client follows it as it changes, outside semver, until it settles.

WebMCP lets a page offer tools to AI agents: the browser's own agent, and sites that embed the page. Allow the `webMcp` client, and every function you made with `tool()` becomes one:

```js
import { serve, tool } from 'glottis';

serve({
    clients: { webMcp: { allowed: true } },
    exports: {
        getRecentlyViewed: tool({
            description: 'List the products this user viewed recently',
            handler:     () => JSON.parse(localStorage.getItem('recentlyViewed') ?? '[]')
        })
    }
});
```

An agent now sees a tool called `getRecentlyViewed`, and calling it runs your function. That's the whole setup: there is nothing to register by hand, and nothing else to call.

### What becomes a tool

Only functions made with `tool()`. Plain functions and constants stay available to other windows and scripts on the page, as always, but agents never see them:

```js
exports: {
    version: '2.1',                                  // a constant: not a tool
    hello:   ({ name }) => `Hello, ${ name }!`,      // a plain function: not a tool
    cart: {
        add: tool({                                  // a tool, called cart_add
            description: 'Add a product to the cart',
            input:       z.object({ id: z.string(), quantity: z.number().int().min(1).default(1) }),
            handler:     ({ id, quantity }) => addToCart({ id, quantity })
        })
    }
}
```

- **Names** come from the path, joined with `_`: `cart.add` is `cart_add`. A service other than `default` adds its name in front, as in `checkout_cart_add`. Pass `name` to `tool()` to choose your own. Characters other than letters, digits, `_` and `-` become `_`, and names are kept to 64 characters, so they also work with MCP clients.
- **Descriptions** come from `description`. Agents choose tools by their descriptions, so write them for a model to read.
- **Arguments** are checked against `input` before your function runs, exactly as for any other caller. A tool with no `input` takes no arguments. Agents always send an object of named arguments, so an `input` that isn't an object, like `z.string()`, is sent as `{ value }` and your function receives just the value.
- **Annotations** pass straight to WebMCP:

  ```js
  buyNow: tool({
      description: 'Buy everything in the cart',
      annotations: { consequentialHint: true },    // agents may ask the user first
      handler:     () => checkout()
  })
  ```

  WebMCP knows `readOnlyHint` (no side effects), `consequentialHint` (significant or irreversible) and `untrustedContentHint` (the result holds outside content, such as reviews, to treat as data). Annotations also appear in the [manifest](#the-manifest).

### What an agent gets back

Whatever your function returns, as JSON. There's no wrapper: data goes as it is, and an error your function throws fails the call.

- A function that returns nothing gives `null`.
- Plain functions and promises inside a result are left out of objects, and become `null` in arrays.
- Values JSON can't hold, like a `BigInt` or an object that contains itself, fail the call.

### Tools that return tools

A function made with `tool()` inside a result becomes a new tool, bound to that result. The agent can then call it without passing any IDs:

```js
exports: {
    openCart: tool({
        description: 'Open the shopping cart',
        handler:     () => {
            const cart = createCart();

            return {
                items: cart.items,
                add:   tool({ description: 'Add a product to this cart', input: z.object({ id: z.string() }), handler: ({ id }) => cart.add(id) }),
                buy:   tool({ description: 'Buy everything in this cart', once: true, handler: () => cart.checkout() })
            };
        }
    })
}
```

The agent calls `openCart` and gets back:

```json
{ "items": [], "add": { "$tool": "openCart_1_add" }, "buy": { "$tool": "openCart_1_buy" } }
```

Each `{ "$tool": ... }` names a tool that now exists, so the agent can go on to call `openCart_1_add({ id: 'red-mug' })` and then `openCart_1_buy()`.

- **Each call gets its own number.** A second `openCart` gives `openCart_2_add`, and numbers are never reused, so an old name can't reach a newer cart.
- **Descriptions say where a tool came from:** "From openCart (call 1): Add a product to this cart".
- **Bound tools go away** after a `once` tool's call, on `stop()`, when the page reloads, and when there are too many. The 20 most recently used results keep their tools, and older ones lose theirs. Change the limit with `webMcp: { allowed: true, maxBoundResults }`.
- **They survive `updateExports()`**, just as references held by code callers do.

### Who can use the tools

By default, the browser's own agent and pages on your own origin. To also offer them to sites that embed your page, list those sites' origins:

```js
clients: { webMcp: { allowed: true, domain: 'https://chatgpt.com' } }
clients: { webMcp: { allowed: true, domain: [ 'https://chatgpt.com', 'https://claude.ai' ] } }
```

WebMCP only accepts exact origins here, so a pattern, a callback or `'*'` throws.

### Different exports for agents

When `exports` is a function, it runs once for WebMCP, with `client.type` set to `CLIENT_TYPE.WEB_MCP`. There's no caller and no props. Use it to give agents a different set of exports from your other callers:

```js
import { CLIENT_TYPE, serve, tool } from 'glottis';

serve({
    clients: { remoteWindow: { allowed: true, domain: '*' }, webMcp: { allowed: true } },
    exports: ({ client }) => {
        switch (client.type) {
            case CLIENT_TYPE.WEB_MCP:
                return { search };                       // agents can only search
            case CLIENT_TYPE.REMOTE_WINDOW:
            case CLIENT_TYPE.LOCAL_WINDOW:
                return { search, refund };
        }
    }
});
```

`updateExports()` runs it again, and only re-registers the tools that changed, so agents keep the rest without a gap.

### Asking the user

There's no connection to approve, so there are two places to ask instead:

- **Before offering tools at all.** The exports function can wait for the user's answer, and return fewer tools, or none, if they decline:

  ```js
  exports: async ({ client }) => {
      if (client.type === CLIENT_TYPE.WEB_MCP && !await askUser('Let AI assistants use this page?')) {
          return {};
      }

      return { search, buyNow };
  }
  ```

- **Inside a risky tool.** Show your own confirmation in the page, and only go ahead once the user clicks. This is the strongest check, because the agent can't click for them:

  ```js
  buyNow: tool({
      description: 'Buy everything in the cart',
      annotations: { consequentialHint: true },
      handler:     async () => {
          if (!await confirmInPage(`Place this order for ${ cart.total }?`)) {
              throw new Error('The user declined');
          }

          return checkout();
      }
  })
  ```

### Frames

A page in a cross-origin iframe can only offer tools if the page embedding it allows it, with the `tools` permission:

```js
connect({ url, target: { type: 'iframe', container, attributes: { allow: 'tools' } } });
```

Without it, the frame offers no tools, and glottis logs nothing, because that's the normal case for a frame. `connect()` never grants the permission for you: letting another site offer tools to the agent on your page is your decision.

### When tools can't be registered

`serve()` returns before tools are registered, so glottis reports problems with `console.error`, naming the tool and the reason: two tools with the same name (neither is registered), an `input` schema that can't become JSON Schema (pass `jsonSchema.input`), a name over 64 characters, or the browser refusing a tool. The other tools are registered as normal.

In a browser without WebMCP, nothing happens and nothing is logged. To check for yourself, use `'modelContext' in document`.

### Trying it out

Chrome has WebMCP behind a flag. Start it with `--enable-features=WebMCP`, or turn on WebMCP in `chrome://flags`, and `document.modelContext` appears. You can then list and run your tools from the console:

```js
const tools = await document.modelContext.getTools();
await document.modelContext.executeTool(tools.find(tool => tool.name === 'cart_add'), { id: 'red-mug' });
```

One thing to know about Chrome today: when a tool throws, the caller only learns that the call failed, not your error's message.

## TypeScript

Pages can publish the type of their exports, and callers can use it:

```ts
// page
import type { ExportsOf } from 'glottis';

const exports = { add: ({ a, b } : { a : number, b : number }) => a + b };

serve({ clients: { remoteWindow: { allowed: true, domain: '*' } }, exports });

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

Serve your API from a small, dedicated page, such as `https://shop.example/api`, that does nothing but call `serve()`, and send a `frame-ancestors` header listing the same origins as your `clients.remoteWindow.domain`:

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

**[WebMCP](https://github.com/webmachinelearning/webmcp)**, and its polyfill [MCP-B](https://github.com/WebMCP-org/npm-packages), let a page register tools for AI agents. Tools take JSON and return a string, with no function references, because the caller is a model. glottis is for code calling code, where callbacks and live objects matter, and it can also offer your `tool()` functions to agents through WebMCP, with no second list of tools to keep in sync. See [AI agents](#ai-agents-webmcp).

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
| `clients` | `{ remoteWindow?: { allowed, domain? }, localWindow?: { allowed }, webMcp?: { allowed, domain?, maxBoundResults? } }` | Who may connect. Remote windows are off until allowed with a `domain` (a string, RegExp, array, or `({ origin }) => boolean \| Promise<boolean>`); scripts on the page are on; WebMCP is off, and its `domain` takes exact origins only. |
| `exports` | object, or `({ client, props, onProps, getProps }) => object \| Promise<object>` | Required. What the page offers. |
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
| `domain` | same forms as `clients.remoteWindow.domain` | The origins the page may be at. Defaults to the URL's origin; required for an existing frame or window. |
| `service` | string | Which service to connect to. Defaults to `'default'`. |
| `props` | object | Data and functions for the page. |
| `timeout` | number | Milliseconds to wait for the page to serve. Defaults to `10000`; `0` waits forever. Once the page has served, its answer can take as long as it needs. |
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

### `tool(options)`

| Option | |
| --- | --- |
| `handler` | Required. The function. |
| `description` | A sentence about what it does. |
| `input`, `output` | Schemas for the first argument and the result. |
| `jsonSchema` | `{ input?, output? }` JSON Schema for the manifest, for validators that cannot produce it. |
| `name` | The WebMCP tool name, in place of the one built from its path. |
| `annotations` | WebMCP hints, such as `{ readOnlyHint: true }`, passed through as they are. |
| `once` | Release after the first call. |

`describe.function(options)` is the old name for `tool()`, and goes in the next release.

### `CLIENT_TYPE`

`REMOTE_WINDOW` (`'remoteWindow'`), `LOCAL_WINDOW` (`'localWindow'`) and `WEB_MCP` (`'webMcp'`): the values of `client.type` in the exports function.

### Errors

| Error | When |
| --- | --- |
| `ConnectTimeoutError` | `connect()` heard nothing in time. |
| `DomainError` | The page refused the caller's origin. |
| `ClientNotAllowedError` | The service does not accept this kind of caller, for example other windows. |
| `ValidationError` | Arguments or props failed their schema. Its `issues` lists what was wrong. |
| `DisconnectedError` | A call on an ended connection or a stale reference. Its `reason` says why. |

## How it works

glottis runs on [post-robot](https://github.com/bluepnume/post-robot), which carries messages between windows, and [sandestin](https://github.com/bluepnume/sandestin), which turns functions and promises into references that call home.

1. When a page calls `serve()`, it announces its services to the window that framed or opened it.
2. `connect()` listens for that announcement, checks the page's origin, and sends a connect request with the service name and props.
3. The page checks the caller's origin, builds the exports, and answers with them and the manifest.
4. A frame that loaded before `connect()` was called is asked once to announce again.

The script-tag build is about 64 KB minified and 22 KB gzipped, most of it post-robot. With a bundler, a page that only calls `serve()` leaves out the code for opening frames and popups.

### Not yet

- Cancelling a call already in progress with an `AbortSignal`.
- Callers in an extension's isolated world.
- Version negotiation between different releases of glottis.

## License

MIT
