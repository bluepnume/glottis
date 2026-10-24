// window.mycelium on a serving page, so scripts in the page's main world can
// find its services without importing anything: `window.mycelium.connect()`.
// It only connects to this page's own services, which keeps the frame and
// popup code out of pages that only serve. The script-tag bundle defines the
// full library under the same name.

import type { Connection } from './client';

import { connectLocal } from './local';

type LocalConnectOptions = Parameters<typeof connectLocal>[0] & {
    readonly url ?: unknown,
    readonly target ?: unknown,
};

const connectHere = <Exports>(options : LocalConnectOptions = {}) : Promise<Connection<Exports>> => {
    return options.url === undefined && options.target === undefined
        ? connectLocal<Exports>(options)
        : Promise.reject(new TypeError(`window.mycelium.connect() from serve() only connects to services on this page; import mycelium to open other pages`));
};

export const installPageGlobal = () : void => {
    const holder = window as unknown as Record<string, { readonly connect ?: unknown } | undefined>;

    if (!holder.mycelium?.connect) {
        holder.mycelium = { ...holder.mycelium, connect: connectHere };
    }
};
