import type { BuildOptions } from 'cugel-scripts/build';

// ES2019 syntax, and one minified script-tag bundle for pages that load
// spor directly, as `window.spor`.
// eslint-disable-next-line import/no-default-export -- cugel-scripts reads the config's default export
export default {
    build: {
        target: 'es2019',

        bundle: {
            entry:      'src/index.ts',
            outfile:    'dist/spor.min.js',
            globalName: 'spor'
        }
    } satisfies Omit<BuildOptions, 'root'>
};
