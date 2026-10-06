// Builds demo/index.html: bundles the backend's parsing code for the browser and inlines it.
// Usage (from the repo root, after `npm install` in backend/):
//   node demo/build.mjs                         -> demo/index.html
//   VOICE_URL=https://... node demo/build.mjs out.html   (link shown where the mic is blocked)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from '../backend/node_modules/esbuild/lib/main.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(dir, 'index.html');

const cryptoShim = {
  name: 'crypto-shim',
  setup(b) {
    b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'crypto', namespace: 'shim' }));
    b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
      contents: 'export default { randomUUID: () => globalThis.crypto.randomUUID() };',
    }));
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(dir, 'entry.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'Aawaz',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  write: false,
  plugins: [cryptoShim],
});
const core = result.outputFiles[0].text;
if (core.toLowerCase().includes('</script')) throw new Error('bundle contains </script>');

const template = await readFile(path.join(dir, 'template.html'), 'utf8');
const html = template
  .replace('/*__CORE__*/', () => core)
  .replace('__VOICE_URL__', () => process.env.VOICE_URL ?? '');
await writeFile(out, html);
console.log(`wrote ${out} (${html.length} bytes)`);
