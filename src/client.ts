// The caller's connection: its state machine (connecting, connected,
// reconnecting after the page navigates, ended), guarded exports, props, and
// the callbacks the caller passed. How messages travel is the channel's job.

import { assertExists } from 'belter';

import type { DisconnectReason } from './constants';

import { DISCONNECT_REASON } from './constants';

import type { ExportsPayload, Props } from './model';
import type { Manifest, Remote } from './types';

import { DisconnectedError } from './errors';
import { guard } from './guard';

export type DisconnectInfo = {
    readonly reason : DisconnectReason,
    // True when the page navigated and mycelium is waiting for it to serve again.
    readonly reconnecting : boolean,
};

export type ConnectionCallbacks<Exports> = {
    readonly onExportsChange ?: (info : { readonly exports : Remote<Exports>, readonly manifest : Manifest }) => void,
    readonly onDisconnect ?: (info : DisconnectInfo) => void,
    readonly onReconnect ?: (info : { readonly exports : Remote<Exports>, readonly manifest : Manifest }) => void,
};

export type Connection<Exports = unknown> = {
    // The page's exports: functions are live, everything else is a copy.
    readonly exports : Remote<Exports>,
    readonly manifest : Manifest,
    readonly service : string,
    readonly origin : string,
    // The window on the other side.
    readonly window : Window | undefined,
    // The iframe, when there is one.
    readonly frame : HTMLIFrameElement | undefined,
    // Merges into the current props and sends them; rejects if the page's
    // props schema refuses the result.
    readonly updateProps : (partial : Props) => Promise<void>,
    // Asks the page for its current exports.
    readonly getExports : () => Promise<Remote<Exports>>,
    readonly disconnect : () => Promise<void>,
};

// How a connection's requests reach the page, once connected.
export type Channel = {
    readonly updateProps : (partial : Props) => Promise<void>,
    readonly getExports : () => Promise<ExportsPayload>,
    readonly disconnect : () => void,
};

type CreateClientOptions<Exports> = ConnectionCallbacks<Exports> & {
    readonly service : string,
    readonly props : Props,
    readonly window : Window | undefined,
    readonly frame : HTMLIFrameElement | undefined,
    // Removes whatever mycelium created for this connection.
    readonly release : () => void,
};

type ConnectedOptions = {
    readonly channel : Channel,
    readonly origin : string,
    readonly payload : ExportsPayload,
};

export type Client<Exports> = {
    readonly connection : Connection<Exports>,
    readonly props : () => Props,
    readonly connected : (options : ConnectedOptions) => void,
    readonly navigated : () => void,
    readonly exportsChanged : (payload : ExportsPayload) => void,
    readonly end : (options : { readonly reason : DisconnectReason, readonly notify : boolean }) => void,
    readonly isReconnecting : () => boolean,
    readonly isEnded : () => boolean,
    readonly onEnd : (listener : () => void) => void,
};

export const createClient = <Exports>(options : CreateClientOptions<Exports>) : Client<Exports> => {
    let props = options.props;
    let generation = 0;
    let reconnecting = false;
    let ended : DisconnectReason | undefined;
    let channel : Channel | undefined;
    let origin = '';
    let exports = undefined as unknown as Remote<Exports>;
    let manifest = undefined as unknown as Manifest;
    let everConnected = false;
    const endListeners : Array<() => void> = [];

    const state = {
        generation:   () => generation,
        ended:        () => ended,
        reconnecting: () => reconnecting
    };

    const take = (payload : ExportsPayload) : void => {
        exports = guard({ value: payload.exports, state, generation }) as Remote<Exports>;
        manifest = payload.manifest;
    };

    const active = () : Channel => {
        if (ended) {
            throw new DisconnectedError({ reason: ended });
        }

        if (reconnecting) {
            throw new DisconnectedError({ reason: DISCONNECT_REASON.NAVIGATED });
        }

        return assertExists(channel, 'channel');
    };

    const end : Client<Exports>['end'] = ({ reason, notify }) => {
        if (ended) {
            return;
        }

        ended = reason;

        if (notify) {
            channel?.disconnect();
        }

        options.release();

        for (const listener of endListeners) {
            listener();
        }

        if (everConnected) {
            options.onDisconnect?.({ reason, reconnecting: false });
        }
    };

    const connection : Connection<Exports> = {
        get exports() {
            return exports;
        },

        get manifest() {
            return manifest;
        },

        get origin() {
            return origin;
        },

        service: options.service,
        window:  options.window,
        frame:   options.frame,

        updateProps: async partial => {
            await active().updateProps(partial);
            props = { ...props, ...partial };
        },

        getExports: async () => {
            take(await active().getExports());

            return exports;
        },

        disconnect: () => {
            end({ reason: DISCONNECT_REASON.DISCONNECTED, notify: true });

            return Promise.resolve();
        }
    };

    return {
        connection,
        props: () => props,

        connected: ({ channel: next, origin: nextOrigin, payload }) => {
            const wasReconnecting = reconnecting;

            channel = next;
            origin = nextOrigin;
            reconnecting = false;
            take(payload);

            if (everConnected && wasReconnecting) {
                options.onReconnect?.({ exports, manifest });
            }

            everConnected = true;
        },

        navigated: () => {
            if (ended || reconnecting) {
                return;
            }

            reconnecting = true;
            generation += 1;
            options.onDisconnect?.({ reason: DISCONNECT_REASON.NAVIGATED, reconnecting: true });
        },

        exportsChanged: payload => {
            take(payload);
            options.onExportsChange?.({ exports, manifest });
        },

        end,
        isReconnecting: () => reconnecting,
        isEnded:        () => ended !== undefined,

        onEnd: listener => {
            endListeners.push(listener);
        }
    };
};
