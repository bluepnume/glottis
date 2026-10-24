// The shapes callers and pages see: what an export looks like from the other
// side, and the manifest that describes a page's exports.

import type { FunctionMetadata } from './describe';
import type { JsonSchema } from './schema';

// A value as it arrives from the other side: functions become async, data is
// a copy, and the same applies all the way down.
export type Remote<T> =
    T extends (...args : infer Args) => infer Result
        ? (...args : Args) => Promise<Remote<Awaited<Result>>>
        : T extends Promise<infer Value>
            ? Promise<Remote<Value>>
            : T extends ReadonlyArray<infer Element>
                ? ReadonlyArray<Remote<Element>>
                : T extends Date | RegExp
                    ? T
                    : T extends object
                        ? { readonly [Key in keyof T] : Remote<T[Key]> }
                        : T;

// The exports a page serves, from what it passes to serve(): the object, or
// what the per-connection function returns. Pages publish this as their API
// type: `export type Api = ExportsOf<typeof exports>`.
export type ExportsOf<Exports> = Exports extends (...args : ReadonlyArray<never>) => infer Result
    ? Awaited<Result>
    : Exports;

export type Manifest = {
    readonly service : string,
    readonly protocol : number,
    readonly description ?: string,
    readonly props ?: JsonSchema,
    // Every function in the exports, by dotted path, with whatever
    // describe.function recorded for it.
    readonly functions : Readonly<Record<string, FunctionMetadata>>,
};
