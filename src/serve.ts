// serve(): the page side. Registers a service, announces it to whoever
// framed or opened this page, and answers connect requests by building the
// exports for each connection.

import type { Cancelable, ProxyWindow } from 'post-robot';

import { noop } from 'belter';
import { getOpener, onCloseWindow } from 'cross-domain-utils';
import { on, send, toProxyWindow, WILDCARD } from 'post-robot';

import type { DisconnectReason } from './constants';

import {
    CLOSE_POLL_INTERVAL, DEFAULT_SERVICE, DISCONNECT_REASON, GOODBYE_KEY, MESSAGE,
    PROTOCOL_VERSION
} from './constants';

import type { DomainMatcher } from './domain';
import type { CallerLink, ExportsPayload, OpenSessionOptions, Props, Service, Session } from './model';
import type { Schema } from './schema';

import { matchesDomain } from './domain';
import { DomainError } from './errors';
import { getGlobalState } from './global';
import { buildManifest } from './manifest';
import { installPageGlobal } from './page-global';
import { toJsonSchema, validate } from './schema';

// What the per-connection exports function receives.
export type ExportsContext<P = Props> = {
    // The caller's origin.
    readonly origin : string,
    // The caller's window, as a value you can message or pass on.
    readonly window : ProxyWindow,
    // The caller's props, validated against `props` when given.
    readonly props : P,
    // Called with the merged props after every updateProps from the caller.
    readonly onProps : (handler : (props : P) => void) => Cancelable,
    // Asks the caller for its latest props.
    readonly getProps : () => Promise<P>,
};

type ConnectionInfo = {
    readonly origin : string,
    readonly window : ProxyWindow,
};

export type ServeOptions<Exports, P = Props> = {
    // Which origins may connect: a string ('*' for any), a RegExp, a list of
    // either, or a callback. Required: making a page public is deliberate.
    readonly domain : DomainMatcher,
    // What this page offers: functions at any depth inside plain objects,
    // plus constants; or a function building them for each connection.
    readonly exports : Exports | ((context : ExportsContext<P>) => Exports | Promise<Exports>),
    // Several services can share a page; callers pick one by name.
    readonly service ?: string,
    readonly description ?: string,
    // A schema the caller's props must satisfy.
    readonly props ?: Schema,
    readonly onConnect ?: (info : ConnectionInfo) => void,
    readonly onDisconnect ?: (info : ConnectionInfo & { readonly reason : DisconnectReason }) => void,
};

export type Server<Exports> = {
    // Ends every connection and stops answering new ones.
    readonly stop : () => void,
    // Rebuilds every connection's exports (with new ones, if given) and
    // pushes them to the callers. References callers already hold survive.
    readonly updateExports : (exports ?: Exports) => Promise<void>,
};

type ServiceState<Exports, P> = {
    readonly options : ServeOptions<Exports, P>,
    readonly name : string,
    exports : ServeOptions<Exports, P>['exports'],
    readonly sessions : Set<Session>,
};

const isFunctionExports = <Exports, P>(
    exports : ServeOptions<Exports, P>['exports']
) : exports is (context : ExportsContext<P>) => Exports | Promise<Exports> => typeof exports === 'function';

type WatchOpenerOptions = { readonly win : Window | ProxyWindow, readonly onClose : () => void };

const watchOpener = ({ win, onClose } : WatchOpenerOptions) : Cancelable | undefined => {
    const opener = getOpener();

    return opener && win === opener
        ? onCloseWindow({ win: opener, callback: onClose, delay: CLOSE_POLL_INTERVAL })
        : undefined;
};

type CreateSessionOptions<Exports, P> = OpenSessionOptions & {
    readonly state : ServiceState<Exports, P>,
};

const createSession = async <Exports, P>(
    { state, id, origin, window: win, props, link, checkDomain } : CreateSessionOptions<Exports, P>
) : Promise<Session> => {
    const { options, name } = state;

    if (checkDomain && !await matchesDomain({ domain: options.domain, origin })) {
        throw new DomainError(origin);
    }

    let current = await validate({ schema: options.props, value: props, subject: 'props' }) as P;
    const handlers = new Set<(props : P) => void>();
    const proxyWin = toProxyWindow(win);

    const context : ExportsContext<P> = {
        origin,
        window: proxyWin,

        get props() {
            return current;
        },

        onProps: handler => {
            handlers.add(handler);

            return { cancel: () => handlers.delete(handler) };
        },

        getProps: async () => {
            current = await validate({ schema: options.props, value: await link.getProps(), subject: 'props' }) as P;

            return current;
        }
    };

    const build = async () : Promise<ExportsPayload> => {
        const exports = isFunctionExports(state.exports)
            ? await state.exports(context)
            : state.exports;

        const propsSchema = toJsonSchema({ schema: options.props });

        return {
            exports,
            manifest: buildManifest({
                exports,
                service:  name,
                protocol: PROTOCOL_VERSION,
                ...options.description === undefined
                    ? {}
                    : { description: options.description },
                ...propsSchema
                    ? { props: propsSchema }
                    : {}
            })
        };
    };

    let payload = await build();

    const watchers : Array<Cancelable> = [];

    const session : Session = {
        id,
        origin,
        window:  win,
        payload: () => payload,

        updateProps: async partial => {
            const merged = await validate({ schema: options.props, value: { ...current as Props, ...partial }, subject: `props` }) as P;

            current = merged;

            for (const handler of handlers) {
                handler(merged);
            }
        },

        rebuild: async () => {
            payload = await build();
            link.pushExports(payload);
        },

        end: ({ reason, notify }) => {

            for (const watcher of watchers) {
                watcher.cancel();
            }

            state.sessions.delete(session);
            getGlobalState().sessions.delete(id);

            if (notify) {
                link.end(reason);
            }

            options.onDisconnect?.({ origin, window: proxyWin, reason });
        }
    };

    const opener = watchOpener({
        win,

        onClose: () => {
            session.end({ reason: DISCONNECT_REASON.CLOSED, notify: false });
        }
    });

    if (opener) {
        watchers.push(opener);
    }

    state.sessions.add(session);
    getGlobalState().sessions.set(id, session);
    options.onConnect?.({ origin, window: proxyWin });

    return session;
};

type AnnounceToOptions = {
    readonly win : Window,
};

const announceTo = ({ win } : AnnounceToOptions) : void => {
    const { services, instanceId } = getGlobalState();

    send(win, MESSAGE.ANNOUNCE, {
        services: [ ...services.keys() ],
        protocol: PROTOCOL_VERSION,
        instanceId
    }, { domain: WILDCARD, fireAndForget: true }).catch(noop);
};

const announce = () : void => {
    const targets = new Set<Window>();

    if (window.parent !== window) {
        targets.add(window.parent);
    }

    const opener = getOpener();

    if (opener) {
        targets.add(opener);
    }

    for (const win of targets) {
        announceTo({ win });
    }
};

type RemoteLinkOptions = {
    readonly win : Window,
    readonly origin : string,
    readonly id : string,
};

const remoteLink = ({ win, origin, id } : RemoteLinkOptions) : CallerLink => ({
    getProps: async () => {
        const { data } = await send(win, MESSAGE.GET_PROPS, { connectionId: id }, { domain: origin });

        return data as Props;
    },

    pushExports: payload => {
        send(win, MESSAGE.EXPORTS_CHANGED, { connectionId: id, ...payload }, { domain: origin }).catch(noop);
    },

    end: reason => {
        send(win, MESSAGE.END, { connectionId: id, reason }, { domain: origin, fireAndForget: true }).catch(noop);
    }
});

type FindSessionOptions = {
    readonly source : Window,
    readonly origin : string,
    readonly data : unknown,
};

// The session a caller's message names, if it really came from that caller.
const findSession = ({ source, origin, data } : FindSessionOptions) : Session => {
    const { connectionId } = data as { readonly connectionId : string };
    const session = getGlobalState().sessions.get(connectionId);

    if (session?.origin !== origin || session.window !== source) {
        throw new Error(`Unknown connection ${ connectionId }`);
    }

    return session;
};

type ConnectRequest = {
    readonly service : string,
    readonly props : unknown,
    readonly connectionId : string,
};

const listenAsPage = () : void => {
    const state = getGlobalState();

    if (state.pageListening) {
        return;
    }

    state.pageListening = true;

    on(MESSAGE.CONNECT, { domain: WILDCARD }, async ({ source, origin, data }) => {
        const { service: name, props, connectionId } = data as ConnectRequest;
        const service = state.services.get(name);

        if (!service) {
            throw new Error(`No service "${ name }" is served on this page`);
        }

        const session = await service.open({
            id:          connectionId,
            origin,
            window:      source,
            props,
            link:        remoteLink({ win: source, origin, id: connectionId }),
            checkDomain: true
        });

        return { instanceId: state.instanceId, ...session.payload() };
    });

    on(MESSAGE.NUDGE, { domain: WILDCARD }, ({ source }) => {
        announceTo({ win: source });
    });

    on(MESSAGE.UPDATE_PROPS, { domain: WILDCARD }, request =>
        findSession(request).updateProps((request.data as { readonly props : Props }).props));

    on(MESSAGE.GET_EXPORTS, { domain: WILDCARD }, request => findSession(request).payload());

    on(MESSAGE.DISCONNECT, { domain: WILDCARD }, request => {
        findSession(request).end({ reason: DISCONNECT_REASON.DISCONNECTED, notify: false });
    });

    // A best-effort goodbye as the page goes, so callers stop waiting at once.
    // A page entering the back-forward cache is not going anywhere.
    window.addEventListener('pagehide', event => {
        if (event.persisted) {
            return;
        }

        for (const session of state.sessions.values()) {
            if (session.window !== window) {
                session.window.postMessage({ [ GOODBYE_KEY ]: state.instanceId }, session.origin);
            }
        }
    });
};

export const serve = <Exports, P = Props>(options : ServeOptions<Exports, P>) : Server<Exports> => {
    // Checked at runtime too, for callers without types.
    if ((options as { readonly domain ?: unknown }).domain === undefined) {
        throw new TypeError(`serve() needs a \`domain\`: the origins that may connect, or '*' for any`);
    }

    const global = getGlobalState();
    const name = options.service ?? DEFAULT_SERVICE;

    if (global.services.has(name)) {
        throw new Error(`A service named "${ name }" is already being served on this page`);
    }

    const state : ServiceState<Exports, P> = { options, name, exports: options.exports, sessions: new Set() };

    const service : Service = {
        name,
        open: sessionOptions => createSession({ ...sessionOptions, state })
    };

    global.services.set(name, service);
    listenAsPage();
    installPageGlobal();
    announce();

    return {
        stop: () => {
            for (const session of state.sessions) {
                session.end({ reason: DISCONNECT_REASON.STOPPED, notify: true });
            }

            global.services.delete(name);
        },

        updateExports: async exports => {
            if (exports !== undefined) {
                state.exports = exports;
            }

            await Promise.all([ ...state.sessions ].map(session => session.rebuild()));
        }
    };
};
