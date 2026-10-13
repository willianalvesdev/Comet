import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import nextEnv from '@next/env';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const next = path.join(root, 'node_modules/next/dist/bin/next');
let server, building, stopping = false;
function configuration() {
    nextEnv.loadEnvConfig(root, false, console, true);
    const host = process.env.APP_HOST || '127.0.0.1', port = Number(process.env.APP_PORT || 5001);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('APP_PORT inválida.');
    if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no .env e execute configurar_banco.bat.');
    const browserHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
    return {host, port, url:`http://${browserHost.includes(':') ? '[' + browserHost + ']' : browserHost}:${port}`};
}
async function checkPort({host, port}) {
    const probe = createServer();
    try {
        await new Promise((resolve, reject) => {probe.once('error', reject); probe.listen(port, host, resolve);});
    } catch {throw new Error('A porta do Comet está ocupada. Use a janela existente ou altere APP_PORT.');}
    finally {if (probe.listening) await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));}
}
async function build() {
    for (const args of [['scripts/sync-static.mjs'], [next, 'build']]) {
        building = spawn(process.execPath, args, {stdio:'inherit', windowsHide:true});
        const [code] = await once(building, 'exit');
        building = undefined;
        if (code !== 0) return false;
    }
    return true;
}
async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const finished = once(child, 'exit');
    child.kill();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {await finished;} finally {clearTimeout(deadline);}
}
async function start(config, openBrowser = false) {
    const {host, port, url} = config;
    let launchError;
    server = spawn(process.execPath, [next, 'start', '--hostname', host, '--port', String(port)], {stdio:['ignore', 'inherit', 'inherit'], windowsHide:true});
    server.on('error', error => {launchError = error;});
    for (let attempt = 0; attempt < 100; attempt++) {
        if (launchError) throw launchError;
        if (server.exitCode !== null) throw new Error('Não foi possível iniciar o Comet. Confira se a porta está livre.');
        try {
            if ((await fetch(url, {signal:AbortSignal.timeout(500)})).ok) {
                console.log(`\nComet disponível em ${url}\nR + Enter reinicia | S + Enter encerra.\n`);
                if (openBrowser && process.platform === 'win32') {
                    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {windowsHide:true, detached:true, stdio:'ignore'});
                    browser.on('error', () => {});
                    browser.unref();
                }
                return;
            }
        } catch {}
        await delay(100);
    }
    throw new Error('O servidor demorou para iniciar. Confira as mensagens acima.');
}
async function exit() {
    if (stopping) return;
    stopping = true;
    await Promise.all([stop(server), stop(building)]);
    process.exit(0);
}
process.on('SIGINT', () => void exit());
process.on('SIGTERM', () => void exit());
try {
    const initial = configuration();
    await checkPort(initial);
    if (!await build()) process.exit(1);
    await start(initial, !process.argv.includes('--no-browser'));
    const input = createInterface({input:process.stdin, terminal:false});
    for await (const line of input) {
        const command = line.trim().toLowerCase();
        if (['s', 'sair'].includes(command)) break;
        if (['r', 'reiniciar'].includes(command)) {
            try {
                const updated = configuration();
                await stop(server);
                await checkPort(updated);
                if (!await build()) throw new Error('A compilação falhou.');
                await start(updated);
            } catch (error) {
                await stop(server);
                console.error(error instanceof Error ? error.message : 'Não foi possível reiniciar.');
                console.log('O servidor está parado. Corrija o erro e use R para tentar novamente.');
            }
        }
    }
} catch (error) {console.error(error instanceof Error ? error.message : 'Falha ao iniciar o Comet.'); process.exitCode = 1;}
finally {await Promise.all([stop(server), stop(building)]); process.stdin.pause();}