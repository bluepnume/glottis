import { greet } from './greet';

export type ShoutOptions = {
    readonly name : string,
};

// A second export so the tree-shaking test has something a consumer of
// `greet` alone must not end up carrying.
export const SHOUT_MARKER = 'CUGEL_BOILERPLATE_SHOUT_MARKER';

export const shout = ({ name } : ShoutOptions) : string => `${ greet({ name }).toUpperCase() } ${ SHOUT_MARKER }`;
