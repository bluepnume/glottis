import { vitestConfig } from 'cugel-scripts/vitest';

import { playwright } from '@vitest/browser-playwright';

const base = vitestConfig({
    root:              import.meta.dirname,
    browser:           true,
    coverageThreshold: 95
});

type Project = {
    readonly test : Readonly<Record<string, unknown>> & { readonly browser ?: Readonly<Record<string, unknown>> },
};

// Chromium with WebMCP's draft API turned on, for the WebMCP suites.
const projects = ((base.test?.projects ?? []) as ReadonlyArray<Project>).map(project => (project.test.browser
    ? {
        ...project,
        test: {
            ...project.test,
            browser: {
                ...project.test.browser,
                provider: playwright({ launchOptions: { args: [ '--enable-features=WebMCP' ] } })
            }
        }
    }
    : project));

// Istanbul, not v8: test pages run their own instrumented copy of src/,
// often cross-origin and so in another process, and post their counters to
// the test page (test/coverage.ts). v8 coverage only sees the test page.
export default {
    ...base,

    test: {
        ...base.test,
        projects,
        coverage: { ...base.test.coverage, provider: 'istanbul' as const }
    }
};
