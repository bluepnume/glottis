// Which origins a page serves, or a caller expects: a string ('*' for any),
// a regular expression, a list of either, or a callback deciding per origin.

import type { DomainMatcher as BasicDomainMatcher } from 'cross-domain-utils';

import { matchDomain } from 'cross-domain-utils';

export type DomainCallback = (options : { readonly origin : string }) => boolean | Promise<boolean>;

export type DomainMatcher = BasicDomainMatcher | DomainCallback;

type MatchesDomainOptions = {
    readonly domain : DomainMatcher,
    readonly origin : string,
};

export const matchesDomain = async ({ domain, origin } : MatchesDomainOptions) : Promise<boolean> => (typeof domain === `function`
    ? await domain({ origin })
    : matchDomain(domain, origin));
