import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || major === 22 && minor < 12) throw new Error('Instale Node.js 22.12 ou superior.');
const digest = createHash('sha256').update(await readFile('package-lock.json')).digest('hex');
const stamp = 'node_modules/.comet-lock.sha256';
let install = true;
try {
    install = await readFile(stamp, 'utf8') !== digest;
    for (const file of ['next/dist/bin/next', 'typescript/bin/tsc', 'tsx/package.json', 'pg/package.json']) await access('node_modules/' + file);
} catch {install = true;}
if (install) {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], {stdio:'inherit', shell:process.platform === 'win32', windowsHide:true});
    const result = await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', resolve);});
    if (result !== 0) process.exit(1);
    await writeFile(stamp, digest);
}