import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const destination = resolve(root, 'apps/web/public/pdfjs');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const folder of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
  await mkdir(resolve(destination, folder), {recursive:true});
  for (const name of await readdir(resolve(source, folder))) {
    await writeFile(resolve(destination,folder,name), await readFile(resolve(source,folder,name)));
  }
}
