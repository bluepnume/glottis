import type { BuildOptions } from 'cugel-scripts/build';

// ES2019 syntax, and one minified script-tag bundle for pages that load
// mycelium directly, as `window.mycelium`.
// eslint-disable-next-line import/no-default-export -- cugel-scripts reads the config's default export
export default {
    build: {
        target: 'es2019',

        bundle: {
            entry:      'src/index.ts',
            outfile:    'dist/mycelium.min.js',
            globalName: 'mycelium'
        }
    } satisfies Omit<BuildOptions, 'root'>
};
