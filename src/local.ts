// A connection to a service on this same page, for scripts in the page's
// main world: browser agents, injected scripts, the page's own code. Every
// value goes through a sandestin loopback, so it behaves exactly like a
// remote connection: data is copied and functions are references.

import { uniqueID } from 'belter';
import { getDomain } from 'cross-domain-utils';
import { dateType, regExpType } from 'sandestin';
import { pair } from 'sandestin/testing';

import { DEFAULT_SERVICE, DISCONNECT_REASON } from './constants';

import type { Connection, ConnectionCallbacks } from './client';
import type { CallerLink, ExportsPayload, Props } from './model';

import { createClient } from './client';
import { getGlobalState } from './global';

type ConnectLocalOptions<Exports> = ConnectionCallbacks<Exports> & {
    readonly service ?: string,
    readonly props ?: Props,
};

export const connectLocal = async <Exports>(options : ConnectLocalOptions<Exports>) : Promise<Connection<Exports>> => {
    const name = options.service ?? DEFAULT_SERVICE;
    const service = getGlobalState().services.get(name);

    if (!service) {
        throw new Error(`No service "${ name }" is served on this page`);
    }

    const [ pageSide, callerSide ] = pair({ types: [ dateType, regExpType ] });

    const toPage = (value : unknown) : unknown => pageSide.decode({ wire: callerSide.encode({ value }) });
    const toCaller = (value : unknown) : unknown => callerSide.decode({ wire: pageSide.encode({ value }) });

    const client = createClient<Exports>({
        ...options,
        service: name,
        props:   options.props ?? {},
        window,
        frame:   undefined,
        release: () => undefined
    });

    const link : CallerLink = {
        getProps: () => Promise.resolve(toPage(client.props()) as Props),

        pushExports: payload => {
            client.exportsChanged({ exports: toCaller(payload.exports), manifest: payload.manifest });
        },

        end: reason => {
            client.end({ reason, notify: false });
        }
    };

    const session = await service.open({
        id:     uniqueID(),
        origin: getDomain(),
        window,
        props:  toPage(options.props ?? {}),
        link,
        client: 'localWindow'
    });

    const current = () : ExportsPayload => {
        const { exports, manifest } = session.payload();

        return { exports: toCaller(exports), manifest };
    };

    client.connected({
        origin:  getDomain(),
        payload: current(),
        channel: {
            updateProps: partial => session.updateProps(toPage(partial) as Props),
            getExports:  () => Promise.resolve(current()),

            disconnect: () => {
                session.end({ reason: DISCONNECT_REASON.DISCONNECTED, notify: false });
            }
        }
    });

    return client.connection;
};
