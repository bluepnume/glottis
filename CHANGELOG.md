# Changelog

## 0.3.0 (2026-10-24)

### Breaking

* the exports function receives `{ client, props, onProps, getProps }`: the caller's `origin` and `window` move into `client`, next to `client.type`, a `CLIENT_TYPE` (`REMOTE_WINDOW`, `LOCAL_WINDOW` or `WEB_MCP`). Change `({ origin }) => ...` to `({ client }) => ... client.origin ...`
* `describe.function()` is now `tool()`. The old name still works in this release, and goes in the next

### Features

* experimental: `clients.webMcp` offers a service's `tool()` functions to AI agents through WebMCP (`document.modelContext`), outside semver while WebMCP is a draft
  * tool names from the export path (`cart_add`), prefixed for a named service, or `tool({ name })`
  * `domain` exposes tools to embedding sites through WebMCP's `exposedTo`, exact origins only
  * the exports function runs once for WebMCP, with `client.type` set to `CLIENT_TYPE.WEB_MCP` and no props
  * `tool()` functions inside a result become bound tools (`openCart_1_add`), marked in place as `{ "$tool": name }`, kept for the 20 most recently used results (`maxBoundResults`)
  * `updateExports()` only re-registers the tools that changed, and `stop()` removes them all
  * problems registering a tool are logged with `console.error`; a browser without WebMCP, or a frame without `allow="tools"`, quietly registers nothing
* `tool({ annotations })` passes WebMCP hints such as `readOnlyHint` and `consequentialHint`, and puts them in the manifest

## 0.2.0 (2026-10-24)

### Breaking

* `serve({ domain })` is replaced by `serve({ clients })`: `clients.remoteWindow: { allowed, domain }` for other windows, off until allowed, and `clients.localWindow: { allowed }` for scripts on the page, on by default. Move `domain: x` to `clients: { remoteWindow: { allowed: true, domain: x } }`. Passing the old option throws with that hint

### Features

* a service can refuse scripts on its own page, and `window.glottis` is only installed when some service allows them
* a kind of caller a service does not allow is refused with a `ClientNotAllowedError`
* kinds of caller added in later versions will be off until allowed

## 0.1.3 (2026-10-24)

* `connect()`'s timeout stops once the page announces itself, so a page that asks its user before answering is never cut off, on the first connect or on reconnecting after a navigation

## 0.1.2 (2026-10-24)

* `connect({ target })` connects to a frame whose page loaded before the caller ever used glottis (post-robot 12.2.1 asks the frame for the hello it already sent to nobody)

## 0.1.1 (2026-10-23)

* published from CI through the npm trusted publisher

## 0.1.0 (2026-10-23)

The first release.

* `serve()` gives a page a public client API: functions at any depth, constants, a per-connection `exports` function with the caller's origin, window and props, `updateExports()` and `stop()`, and named services
* `connect()` reaches a page in a hidden iframe, a visible iframe with any attributes, a popup, or a frame or window you already have; with a timeout, an `AbortSignal`, and lifecycle callbacks
* connections survive the page navigating or reloading, and end cleanly when its window closes
* props from the caller, merged by `updateProps()` and validated by an optional schema
* `describe.function()` adds descriptions and Standard Schema validation (zod, valibot, arktype), with JSON Schema in a manifest every connection carries
* `domain` is required on `serve()`, and accepts a string, a RegExp, a list, or a sync or async callback
* `window.glottis.connect()` on a serving page connects scripts in the same page, with the same copy and reference rules as a remote connection
