import { build } from 'cugel-scripts/build';
import { build as esbuild } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

// Builds the package, then bundles a consumer that imports only `greet` and
// asserts nothing from shout.ts came along. If this fails, something started
// doing work at import time, or an export stopped being a plain named export.
describe('tree shaking', () => {
    it('a consumer of greet alone does not carry shout', async () => {
        const outDir = await mkdtemp(path.join(os.tmpdir(), 'cugel-boilerplate-shake-'));

        try {
            await build({ root, outDir, declarations: false });

            const consumer = path.join(outDir, 'consumer.js');

            await writeFile(consumer, `import { greet } from './src/index.js';\nconsole.log(greet({ name: 'x' }));\n`);

            const bundled = await esbuild({ entryPoints: [ consumer ], bundle: true, write: false, format: 'esm' });
            const output = bundled.outputFiles.map(file => file.text).join('\n');

            expect(output).toContain('Hello, ');
            expect(output).not.toContain('CUGEL_BOILERPLATE_SHOUT_MARKER');
        } finally {
            await rm(outDir, { recursive: true, force: true });
        }
    }, 60_000);
});
