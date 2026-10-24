// The one window global glottis keeps. Every copy of the library on a page
// reads and writes the same object.

import { uniqueID } from 'belter';

import type { ClientRecord, Service, Session } from './model';

const GLOBAL_KEY = '__glottis_0__';

type GlobalState = {
    // This page load; a reloaded page announces a new one.
    readonly instanceId : string,
    readonly services : Map<string, Service>,
    readonly sessions : Map<string, Session>,
    readonly clients : Map<string, ClientRecord>,
    pageListening : boolean,
    callerListening : boolean,
};

export const getGlobalState = () : GlobalState => {
    const holder = window as unknown as Record<string, GlobalState | undefined>;

    holder[GLOBAL_KEY] ??= {
        instanceId:      uniqueID(),
        services:        new Map(),
        sessions:        new Map(),
        clients:         new Map(),
        pageListening:   false,
        callerListening: false
    };

    return holder[GLOBAL_KEY];
};
