// Wraps the functions a caller receives so a call on a connection that has
// ended, or on a reference from a page that has since navigated, rejects
// with DisconnectedError; results are guarded the same way, all the way
// down, and always come back as native promises.

import type { DisconnectReason } from './constants';

import { DISCONNECT_REASON } from './constants';

import { DisconnectedError } from './errors';
import { isPlainObject } from './manifest';

// Where a connection is, as guarded functions see it.
type GuardState = {
    // Bumped each time the page navigates; references from an older
    // generation belong to a page that is gone.
    readonly generation : () => number,
    // Why it ended, if it has.
    readonly ended : () => DisconnectReason | undefined,
    readonly reconnecting : () => boolean,
};

type AnyFunction = (...args : ReadonlyArray<unknown>) => unknown;

type GuardOptions = {
    readonly value : unknown,
    readonly state : GuardState,
    readonly generation : number,
};

export const guard = ({ value, state, generation } : GuardOptions) : unknown => {
    if (typeof value === 'function') {
        const fn = value as AnyFunction;

        const guarded = async (...args : ReadonlyArray<unknown>) : Promise<unknown> => {
            const ended = state.ended();

            if (ended) {
                throw new DisconnectedError({ reason: ended });
            }

            if (generation !== state.generation() || state.reconnecting()) {
                throw new DisconnectedError({ reason: DISCONNECT_REASON.NAVIGATED });
            }

            return guard({ value: await fn(...args), state, generation });
        };

        Object.defineProperty(guarded, 'name', { value: fn.name });

        return guarded;
    }

    if (Array.isArray(value)) {
        return value.map((element : unknown) => guard({ value: element, state, generation }));
    }

    return isPlainObject(value)
        ? Object.fromEntries(Object.entries(value).map(([ key, child ]) => [
            key,
            guard({ value: child, state, generation })
        ]))
        : value;
};
