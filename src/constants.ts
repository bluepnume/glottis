// The message names spor sends over post-robot, the protocol version
// every announce carries, and the defaults callers can override.

export const PROTOCOL_VERSION = 1;

export const DEFAULT_SERVICE = 'default';

// How long connect waits for the page to answer, in milliseconds.
export const DEFAULT_CONNECT_TIMEOUT = 10_000;

// How often a connection checks whether its window has closed.
export const CLOSE_POLL_INTERVAL = 500;

export const MESSAGE = {
    // page -> caller
    ANNOUNCE:        'spor_announce',
    END:             'spor_end',
    EXPORTS_CHANGED: 'spor_exports_changed',
    GET_PROPS:       'spor_get_props',

    // caller -> page
    CONNECT:      'spor_connect',
    NUDGE:        'spor_nudge',
    UPDATE_PROPS: 'spor_update_props',
    GET_EXPORTS:  'spor_get_exports',
    DISCONNECT:   'spor_disconnect'
} as const;

// The goodbye a page sends as it unloads goes as a plain postMessage under
// this key: a message sent while a page unloads arrives with no source
// window, which post-robot (rightly) drops.
export const GOODBYE_KEY = '__spor_goodbye__';

export const TARGET_TYPE = {
    IFRAME: 'iframe',
    POPUP:  'popup'
} as const;

export type TargetType = typeof TARGET_TYPE[keyof typeof TARGET_TYPE];

// Why a connection ended, as onDisconnect and DisconnectedError report it.
export const DISCONNECT_REASON = {
    // The caller called disconnect().
    DISCONNECTED: 'disconnected',
    // The page called stop().
    STOPPED:      'stopped',
    // The frame or popup closed, or its element left the page.
    CLOSED:       'closed',
    // The page navigated or reloaded; spor is reconnecting.
    NAVIGATED:    'navigated',
    // The page navigated and did not serve again in time.
    GONE:         'gone'
} as const;

export type DisconnectReason = typeof DISCONNECT_REASON[keyof typeof DISCONNECT_REASON];
