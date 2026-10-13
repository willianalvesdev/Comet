import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function freePort() {
    const socket = createServer();
    await new Promise<void>((resolve, reject) => {socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve);});
    const address = socket.address();
    assert.ok(address && typeof address !== 'string');
    await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
    return address.port;
}

test('iniciador: falha ao recompilar mantém R disponível e encerra o Next ao sair', {timeout:30000}, async () => {
    const root = process.cwd(), artifacts = path.resolve(root, 'artifacts');
    await mkdir(artifacts, {recursive:true});
    const directory = await mkdtemp(path.join(artifacts, 'launcher-test-'));
    const port = await freePort();
    const childEnvironment = {...process.env};
    for (const name of ['APP_HOST', 'APP_PORT', 'DATABASE_URL', '__NEXT_PROCESSED_ENV', 'NODE_ENV']) delete childEnvironment[name];
    let child: ReturnType<typeof spawn> | undefined;
    let output = '';
    try {
        await mkdir(path.join(directory, 'scripts'), {recursive:true});
        await mkdir(path.join(directory, 'node_modules/next/dist/bin'), {recursive:true});
        await cp(path.join(root, 'scripts/start.mjs'), path.join(directory, 'scripts/start.mjs'));
        await writeFile(path.join(directory, 'scripts/sync-static.mjs'), '');
        await writeFile(path.join(directory, '.env'), `APP_HOST=127.0.0.1\nAPP_PORT=${port}\nDATABASE_URL=postgresql://unused@127.0.0.1/unused\n`);
        await writeFile(path.join(directory, 'node_modules/next/dist/bin/next'), `
const fs = require('node:fs');
if (process.argv[2] === 'build') {
    if (fs.existsSync('fail-build')) {console.log('mock:build-failed'); process.exit(1);}
    console.log('mock:built');
} else {
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    require('node:http').createServer((request,response) => response.end('fixture')).listen(port, '127.0.0.1', () => console.log('mock:started'));
}
`);
        child = spawn(process.execPath, ['scripts/start.mjs', '--no-browser'], {cwd:directory, env:childEnvironment, windowsHide:true, stdio:['pipe','pipe','pipe']});
        child.stdout?.on('data', chunk => {output += String(chunk);});
        child.stderr?.on('data', chunk => {output += String(chunk);});
        const exited = once(child, 'exit');
        const waitFor = async (predicate: () => boolean) => {
            const until = Date.now() + 10000;
            while (!predicate()) {
                assert.equal(child?.exitCode, null, output);
                assert.ok(Date.now() < until, output);
                await delay(25);
            }
        };
        await waitFor(() => output.includes('Comet disponível'));
        assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
        const duplicate = spawn(process.execPath, ['scripts/start.mjs', '--no-browser'], {cwd:directory, env:childEnvironment, windowsHide:true, stdio:['ignore','pipe','pipe']});
        let duplicateOutput = '';
        duplicate.stdout.on('data', chunk => {duplicateOutput += String(chunk);});
        duplicate.stderr.on('data', chunk => {duplicateOutput += String(chunk);});
        assert.equal((await once(duplicate, 'exit'))[0], 1);
        assert.ok(duplicateOutput.includes('ocupada'), duplicateOutput);
        assert.ok(!duplicateOutput.includes('mock:built'), duplicateOutput);
        await writeFile(path.join(directory, 'fail-build'), '');
        child.stdin?.write('r\n');
        await waitFor(() => output.includes('O servidor está parado'));
        await assert.rejects(fetch(`http://127.0.0.1:${port}`, {signal:AbortSignal.timeout(1000)}));
        await rm(path.join(directory, 'fail-build'));
        child.stdin?.write('r\n');
        await waitFor(() => output.split('Comet disponível').length === 3);
        assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
        child.stdin?.end('s\n');
        assert.equal((await exited)[0], 0, output);
        await assert.rejects(fetch(`http://127.0.0.1:${port}`, {signal:AbortSignal.timeout(1000)}));
    } finally {
        if (child && child.exitCode === null) {const deadline = setTimeout(() => child?.kill(), 1000); child.stdin?.end('s\n'); await once(child, 'exit'); clearTimeout(deadline);}
        assert.ok(path.resolve(directory).startsWith(artifacts + path.sep));
        await rm(directory, {recursive:true, force:true});
    }
});