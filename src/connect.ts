// connect(): the caller side. Opens or adopts the target, waits for the page
// to announce the service, connects with the caller's props, and keeps the
// connection alive across the page navigating or reloading.

import type { Cancelable } from 'post-robot';

import { noop, uniqueID, watchElementForClose } from 'belter';
import { getDomainFromUrl, isWindowClosed, onCloseWindow } from 'cross-domain-utils';
import { on, send, WILDCARD } from 'post-robot';

import type { DisconnectReason } from './constants';

import {
    CLOSE_POLL_INTERVAL, DEFAULT_CONNECT_TIMEOUT, DEFAULT_SERVICE, DISCONNECT_REASON, GOODBYE_KEY,
    MESSAGE, PROTOCOL_VERSION
} from './constants';

import type { Channel, Connection, ConnectionCallbacks } from './client';
import type { DomainMatcher } from './domain';
import type { AnnounceData, ClientRecord, ExportsPayload, Props } from './model';
import type { CreateTarget, ExistingTarget, OpenedTarget } from './target';

import { createClient } from './client';
import { matchesDomain } from './domain';
import { ConnectTimeoutError, DisconnectedError } from './errors';
import { getGlobalState } from './global';
import { connectLocal } from './local';
import { openTarget } from './target';

// How long to wait after a goodbye before deciding the window closed rather
// than navigated.
const GOODBYE_SETTLE_DELAY = 50;

export type ConnectOptions<Exports = unknown> = ConnectionCallbacks<Exports> & {
    // The page to open. Leave out both `url` and `target` to connect to the
    // services on this page (window.glottis.connect()).
    readonly url ?: string,
    // How to open it ({ type: 'iframe' } or { type: 'popup' }), or a frame or
    // window you already have. Defaults to a hidden iframe.
    readonly target ?: CreateTarget | ExistingTarget,
    // The origins the page may be at. Defaults to the URL's origin; required
    // for an existing target.
    readonly domain ?: DomainMatcher,
    readonly service ?: string,
    readonly props ?: Props,
    // Milliseconds to wait for the page; 0 waits forever.
    readonly timeout ?: number,
    readonly signal ?: AbortSignal,
};

type FindClientOptions = {
    readonly source : Window,
    readonly origin : string,
    readonly data : unknown,
};

const findClient = ({ source, origin, data } : FindClientOptions) : ClientRecord => {
    const { connectionId } = data as { readonly connectionId : string };
    const record = getGlobalState().clients.get(connectionId);

    if (record?.window() !== source || record.origin() !== origin) {
        throw new Error(`Unknown connection ${ connectionId }`);
    }

    return record;
};

const listenAsCaller = () : void => {
    const state = getGlobalState();

    if (state.callerListening) {
        return;
    }

    state.callerListening = true;

    on(MESSAGE.ANNOUNCE, { domain: WILDCARD }, ({ source, origin, data }) => {
        for (const record of state.clients.values()) {
            if (record.window() === source) {
                record.onAnnounce({ origin, data: data as AnnounceData });
            }
        }
    });

    // The goodbye arrives as a plain message, often with no source window
    // (the page is unloading); the instance id and origin identify it.
    window.addEventListener('message', event => {
        const goodbye : unknown = (event.data as Readonly<Record<string, unknown>> | null)?.[GOODBYE_KEY];

        if (typeof goodbye !== 'string') {
            return;
        }

        for (const record of state.clients.values()) {
            record.onGoodbye({ instanceId: goodbye, origin: event.origin });
        }
    });

    on(MESSAGE.GET_PROPS, { domain: WILDCARD }, request => findClient(request).getProps());

    on(MESSAGE.EXPORTS_CHANGED, { domain: WILDCARD }, request => {
        findClient(request).onExportsChanged(request.data as ExportsPayload);
    });

    on(MESSAGE.END, { domain: WILDCARD }, request => {
        findClient(request).onEnd((request.data as { readonly reason : DisconnectReason }).reason);
    });
};

type RemoteChannelOptions = {
    readonly win : Window,
    readonly origin : string,
    readonly id : string,
};

const remoteChannel = ({ win, origin, id } : RemoteChannelOptions) : Channel => ({
    updateProps: async partial => {
        await send(win, MESSAGE.UPDATE_PROPS, { connectionId: id, props: partial }, { domain: origin });
    },

    getExports: async () => {
        const { data } = await send(win, MESSAGE.GET_EXPORTS, { connectionId: id }, { domain: origin });

        return data as ExportsPayload;
    },

    disconnect: () => {
        send(win, MESSAGE.DISCONNECT, { connectionId: id }, { domain: origin, fireAndForget: true }).catch(noop);
    }
});

type ConnectResponse = ExportsPayload & {
    readonly instanceId : string,
};

const expectedDomain = <Exports>(options : ConnectOptions<Exports>) : DomainMatcher => {
    if (options.domain !== undefined) {
        return options.domain;
    }

    if (options.url === undefined) {
        throw new TypeError(`connect() needs a \`domain\` for an existing frame or window: the origin the page should be at`);
    }

    return getDomainFromUrl(new URL(options.url, location.href).href);
};

const toError = (err : unknown) : Error => (err instanceof Error
    ? err
    : new Error(String(err)));

type ConnectRemoteOptions<Exports> = {
    readonly options : ConnectOptions<Exports>,
    readonly opened : OpenedTarget,
};

const connectRemote = <Exports>(
    { options, opened } : ConnectRemoteOptions<Exports>
) : Promise<Connection<Exports>> => new Promise((resolve, reject) => {
    const { win, frame } = opened;
    const id = uniqueID();
    const service = options.service ?? DEFAULT_SERVICE;
    const timeout = options.timeout ?? DEFAULT_CONNECT_TIMEOUT;
    const domain = expectedDomain(options);
    const watchers : Array<Cancelable> = [];
    const global = getGlobalState();

    let settled = false;
    let connecting = false;
    let instanceId : string | undefined;
    let giveUp : ReturnType<typeof setTimeout> | undefined;
    let connectTimer : ReturnType<typeof setTimeout> | undefined;

    const client = createClient<Exports>({
        ...options,
        service,
        props:  options.props ?? {},
        window: win,
        frame,

        release: () => {
            clearTimeout(giveUp);
            clearTimeout(connectTimer);

            for (const watcher of watchers) {
                watcher.cancel();
            }

            global.clients.delete(id);

            if (opened.owned) {
                opened.remove();
            }
        }
    });

    // Only ever called before the connection settles.
    const fail = (err : unknown) : void => {
        settled = true;
        reject(toError(err));
        client.end({ reason: DISCONNECT_REASON.CLOSED, notify: false });
    };

    const startGiveUp = () : void => {
        clearTimeout(giveUp);

        if (timeout > 0) {
            giveUp = setTimeout(() => {
                client.end({ reason: DISCONNECT_REASON.GONE, notify: false });
            }, timeout);
        }
    };

    const connectTo = async (origin : string) : Promise<void> => {
        if (connecting || client.isEnded()) {
            return;
        }

        connecting = true;

        try {
            if (!await matchesDomain({ domain, origin })) {
                return;
            }

            const { data } = await send(win, MESSAGE.CONNECT, {
                service,
                props:        client.props(),
                connectionId: id,
                protocol:     PROTOCOL_VERSION
            }, { domain: origin });

            const response = data as ConnectResponse;

            instanceId = response.instanceId;
            clearTimeout(giveUp);
            client.connected({ channel: remoteChannel({ win, origin, id }), origin, payload: response });

            if (!settled) {
                settled = true;
                clearTimeout(connectTimer);
                resolve(client.connection);
            }
        } catch (err) {
            if (settled) {
                client.end({ reason: DISCONNECT_REASON.GONE, notify: false });
            } else {
                fail(err);
            }
        } finally {
            connecting = false;
        }
    };

    const record : ClientRecord = {
        id,
        window: () => win,
        origin: () => client.connection.origin,

        onAnnounce: ({ origin, data }) => {
            if (client.isEnded() || !data.services.includes(service)) {
                return;
            }

            if (instanceId !== undefined && data.instanceId !== instanceId) {
                client.navigated();
                startGiveUp();
            }

            if (instanceId === undefined || data.instanceId !== instanceId) {
                connectTo(origin).catch(noop);
            }
        },

        // A page says goodbye both when it navigates and when its window
        // closes; a closed window is not coming back.
        onGoodbye: ({ instanceId: leaving, origin }) => {
            if (leaving !== instanceId || origin !== client.connection.origin) {
                return;
            }

            setTimeout(() => {
                if (isWindowClosed(win) || (frame && !frame.isConnected)) {
                    client.end({ reason: DISCONNECT_REASON.CLOSED, notify: false });
                } else {
                    client.navigated();
                    startGiveUp();
                }
            }, GOODBYE_SETTLE_DELAY);
        },

        onExportsChanged: payload => {
            client.exportsChanged(payload);
        },

        onEnd: reason => {
            client.end({ reason, notify: false });
        },

        getProps: () => client.props()
    };

    global.clients.set(id, record);

    // Closed, or its element gone: check again shortly, since a frame put
    // straight back into the page reloads instead of closing.
    const closed = () : void => {
        setTimeout(() => {
            if (isWindowClosed(win) || (frame && !frame.isConnected)) {
                if (settled) {
                    client.end({ reason: DISCONNECT_REASON.CLOSED, notify: false });
                } else {
                    fail(new DisconnectedError({ reason: DISCONNECT_REASON.CLOSED }));
                }
            }
        }, 200);
    };

    watchers.push(onCloseWindow({ win, callback: closed, delay: CLOSE_POLL_INTERVAL }));

    if (frame) {
        watchers.push(watchElementForClose({ element: frame, handler: closed }));
    }

    if (timeout > 0) {
        connectTimer = setTimeout(() => {
            if (!settled) {
                fail(new ConnectTimeoutError({ target: options.url ?? 'the given target', service, timeout }));
            }
        }, timeout);
    }

    const { signal } = options;

    if (signal) {
        const abort = () : void => {
            if (!settled) {
                fail(signal.reason);
            }
        };

        if (signal.aborted) {
            abort();

            return;
        }

        signal.addEventListener('abort', abort, { once: true });
        client.onEnd(() => signal.removeEventListener('abort', abort));
    }

    // A page that loaded before connect() was called already announced to
    // nobody; ask it once to announce again.
    if (!opened.owned) {
        send(win, MESSAGE.NUDGE, {}, { domain: WILDCARD, fireAndForget: true }).catch(noop);
    }
});

export const connect = <Exports = unknown>(options : ConnectOptions<Exports> = {}) : Promise<Connection<Exports>> => {
    if (options.url === undefined && options.target === undefined) {
        return connectLocal(options);
    }

    listenAsCaller();

    let opened : OpenedTarget;

    try {
        opened = openTarget({ url: options.url, target: options.target });
    } catch (err) {
        return Promise.reject(toError(err));
    }

    return connectRemote({ options, opened });
};
