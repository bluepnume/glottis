// The records the page side and the caller side keep, shared through one
// window global so two copies of glottis on a page see the same services
// and connections.

import type { DisconnectReason } from './constants';

import type { Manifest } from './types';

export type Props = Readonly<Record<string, unknown>>;

type ClientKind = 'remoteWindow' | 'localWindow';

export type ExportsPayload = {
    readonly exports : unknown,
    readonly manifest : Manifest,
};

// How a page-side session reaches its caller: over post-robot for a remote
// caller, or directly for a local one.
export type CallerLink = {
    readonly getProps : () => Promise<Props>,
    readonly pushExports : (payload : ExportsPayload) => void,
    readonly end : (reason : DisconnectReason) => void,
};

export type Session = {
    readonly id : string,
    readonly origin : string,
    readonly window : Window,
    readonly payload : () => ExportsPayload,
    readonly updateProps : (partial : Props) => Promise<void>,
    readonly rebuild : () => Promise<void>,
    readonly end : (options : { readonly reason : DisconnectReason, readonly notify : boolean }) => void,
};

export type OpenSessionOptions = {
    readonly id : string,
    readonly origin : string,
    readonly window : Window,
    readonly props : unknown,
    readonly link : CallerLink,
    // Which kind of client is connecting, so the service can check that
    // kind is allowed, and check a remote window's origin.
    readonly client : ClientKind,
};

export type Service = {
    readonly name : string,
    readonly open : (options : OpenSessionOptions) => Promise<Session>,
};

// What the caller side keeps per connection, for the listeners to route to.
export type ClientRecord = {
    readonly id : string,
    readonly window : () => Window | undefined,
    readonly onAnnounce : (options : { readonly origin : string, readonly data : AnnounceData }) => void,
    readonly onGoodbye : (options : { readonly instanceId : string, readonly origin : string }) => void,
    readonly onExportsChanged : (payload : ExportsPayload) => void,
    readonly onEnd : (reason : DisconnectReason) => void,
    readonly getProps : () => Props,
    readonly origin : () => string,
};

export type AnnounceData = {
    readonly services : ReadonlyArray<string>,
    readonly protocol : number,
    readonly instanceId : string,
};
