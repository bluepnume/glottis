# Changelog

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
