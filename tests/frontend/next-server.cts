import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

export async function startNextServer(root: string) {
    const socket = createServer();
    await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('Porta de testes indisponível.');
    const port = address.port;
    await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
    const child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
        cwd:root, windowsHide:true, stdio:['ignore', 'pipe', 'pipe'], env:{...process.env, NODE_ENV:'production'},
    });
    let output = '', failed: Error | null = null;
    child.stdout.on('data', chunk => {output = (output + String(chunk)).slice(-12000);});
    child.stderr.on('data', chunk => {output = (output + String(chunk)).slice(-12000);});
    child.once('error', error => {failed = error;});
    const origin = `http://127.0.0.1:${port}`;
    const stop = async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill();
        await exited;
    };
    try {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            if (failed || child.exitCode !== null) throw failed || new Error(output);
            try {
                if ((await fetch(origin, {signal:AbortSignal.timeout(1000)})).ok) return {origin, stop};
            } catch {}
            await delay(100);
        }
        throw new Error('O Next.js de teste não iniciou: ' + output);
    } catch (error) {
        await stop();
        throw error;
    }
}