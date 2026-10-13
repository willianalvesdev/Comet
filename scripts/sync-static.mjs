import { cp, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const directory of ['img', 'fonts', 'schemas']) {
    const destination = path.join(root, 'public/static', directory);
    await mkdir(destination, {recursive:true});
    await cp(path.join(root, 'static', directory), destination, {recursive:true});
}
for (const filename of ['manifest.webmanifest', 'robots.txt', 'llms.txt']) {
    await access(path.join(root, filename));
    await cp(path.join(root, filename), path.join(root, 'public', filename));
}