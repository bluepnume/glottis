import { vitestConfig } from 'cugel-scripts/vitest';

const base = vitestConfig({
    root:              import.meta.dirname,
    browser:           true,
    coverageThreshold: 95
});

// Istanbul, not v8: test pages run their own instrumented copy of src/,
// often cross-origin and so in another process, and post their counters to
// the test page (test/coverage.ts). v8 coverage only sees the test page.
export default {
    ...base,

    test: {
        ...base.test,
        coverage: { ...base.test.coverage, provider: 'istanbul' as const }
    }
};
