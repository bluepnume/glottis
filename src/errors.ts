// The errors glottis throws. Each has a stable `name`, so a caller can tell
// them apart even after they cross a window boundary.

import type { DisconnectReason } from './constants';

/* eslint-disable unicorn/custom-error-definition -- the names are part of the API and cross windows as strings */

const REASON_MESSAGES : Readonly<Record<DisconnectReason, string>> = {
    disconnected: 'The connection was disconnected',
    stopped:      'The page stopped serving',
    closed:       'The window closed',
    navigated:    'The page navigated away; this reference belongs to the old page',
    gone:         'The page navigated away and did not serve again'
};

type DisconnectedErrorOptions = {
    readonly reason : DisconnectReason,
};

// A call on a connection, or on a reference from it, after it ended.
export class DisconnectedError extends Error {
    readonly reason : DisconnectReason;

    constructor({ reason } : DisconnectedErrorOptions) {
        super(REASON_MESSAGES[reason]);
        this.name = 'DisconnectedError';
        this.reason = reason;
    }
}

type ConnectTimeoutErrorOptions = {
    readonly target : string,
    readonly service : string,
    readonly timeout : number,
};

// connect() heard nothing from the page in time.
export class ConnectTimeoutError extends Error {
    constructor({ target, service, timeout } : ConnectTimeoutErrorOptions) {
        super([
            `No glottis service "${ service }" answered from ${ target } within ${ timeout }ms.`,
            'Likely causes: the page refuses to be framed (X-Frame-Options or a frame-ancestors policy),',
            'the URL is wrong, or the page never called serve() for this service.'
        ].join(' '));

        this.name = 'ConnectTimeoutError';
    }
}

type ValidationIssue = {
    readonly message : string,
    readonly path ?: ReadonlyArray<PropertyKey | { readonly key : PropertyKey }>,
};

type ValidationErrorOptions = {
    readonly subject : string,
    readonly issues : ReadonlyArray<ValidationIssue>,
};

const describeIssue = ({ message, path } : ValidationIssue) : string => {
    const keys = (path ?? []).map(segment => String(typeof segment === 'object'
        ? segment.key
        : segment));

    return keys.length
        ? `${ keys.join('.') }: ${ message }`
        : message;
};

// Arguments or props that failed their schema.
export class ValidationError extends Error {
    readonly issues : ReadonlyArray<string>;

    constructor({ subject, issues } : ValidationErrorOptions) {
        const described = issues.map(describeIssue);

        super(`Invalid ${ subject }: ${ described.join('; ') }`);
        this.name = 'ValidationError';
        this.issues = described;
    }
}

const CLIENT_DESCRIPTIONS : Readonly<Record<string, string>> = {
    remoteWindow: 'other windows',
    localWindow:  'scripts on this page'
};

type ClientNotAllowedErrorOptions = {
    readonly service : string,
    readonly client : string,
};

// The service does not accept this kind of client at all.
export class ClientNotAllowedError extends Error {
    constructor({ service, client } : ClientNotAllowedErrorOptions) {
        super(`Service "${ service }" does not accept connections from ${ CLIENT_DESCRIPTIONS[client] ?? client }`);
        this.name = 'ClientNotAllowedError';
    }
}

// The page refused the caller's origin.
export class DomainError extends Error {
    constructor(origin : string) {
        super(`Origin ${ origin } is not allowed to connect`);
        this.name = 'DomainError';
    }
}
/* eslint-enable unicorn/custom-error-definition */
