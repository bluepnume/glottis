import { build } from 'cugel-scripts/build';
import { build as esbuild } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';

const gzip = promisify(gzipCallback);

const root = path.resolve(import.meta.dirname, '..');

// The size budget for the script-tag bundle, post-robot and its
// dependencies included (about 40.5 KB of the total on their own).
const BUDGET = { raw: 60 * 1024, gzip: 20 * 1024 };

describe('the build', () => {
    it('lets a page that only serves leave the connect side out', async () => {
        const outDir = await mkdtemp(path.join(os.tmpdir(), 'mycelium-shake-'));

        try {
            await build({ root, outDir, declarations: false });

            const consumer = path.join(outDir, 'consumer.js');

            await writeFile(consumer, `import { serve } from './src/index.js';\nserve({ domain: '*', exports: {} });\n`);

            const bundled = await esbuild({
                entryPoints: [ consumer ],
                bundle:      true,
                write:       false,
                format:      'esm',
                minify:      true,
                nodePaths:   [ path.join(root, 'node_modules') ]
            });

            const output = bundled.outputFiles.map(file => file.text).join('\n');

            expect(output).toContain('mycelium_announce');
            expect(output).not.toContain('No element matches container');
        } finally {
            await rm(outDir, { recursive: true, force: true });
        }
    }, 60_000);

    it('keeps the script-tag bundle within its size budget', async () => {
        const bundled = await esbuild({
            entryPoints: [ path.join(root, 'src/index.ts') ],
            bundle:      true,
            write:       false,
            format:      'iife',
            globalName:  'mycelium',
            minify:      true,
            target:      'es2019'
        });

        const [ file ] = bundled.outputFiles;
        const raw = file?.contents.byteLength ?? 0;
        const gzipped = (await gzip(file?.contents ?? new Uint8Array())).byteLength;

        expect(raw).toBeLessThan(BUDGET.raw);
        expect(gzipped).toBeLessThan(BUDGET.gzip);
    }, 60_000);
});
