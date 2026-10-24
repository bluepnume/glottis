// window.glottis on a serving page, so scripts in the page's main world can
// find its services without importing anything: `window.glottis.connect()`.
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
        : Promise.reject(new TypeError(`window.glottis.connect() from serve() only connects to services on this page; import glottis to open other pages`));
};

export const installPageGlobal = () : void => {
    const holder = window as unknown as Record<string, { readonly connect ?: unknown } | undefined>;

    if (!holder.glottis?.connect) {
        holder.glottis = { ...holder.glottis, connect: connectHere };
    }
};
