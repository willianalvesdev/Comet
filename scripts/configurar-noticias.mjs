import { readFile, writeFile, rename } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let muted = false;
const output = new Writable({write(chunk, encoding, callback) {if (!muted) process.stdout.write(chunk, encoding); callback();}});
const input = createInterface({input:process.stdin, output, terminal:!!process.stdin.isTTY});
try {
    console.log('Obtenha sua chave no painel de https://newsapi.org/');
    process.stdout.write('Chave NewsAPI (a digitação fica invisível; Enter cancela): ');
    muted = true;
    const token = (await input.question('')).trim();
    muted = false;
    console.log('');
    if (!token) console.log('Nenhuma alteração realizada.');
    else {
        if (token.length > 512 || /[\s\x00-\x1f]/.test(token)) throw new Error('Chave inválida. Copie somente o token do painel.');
        const filename = path.join(root, '.env');
        let previous;
        try {previous = await readFile(filename, 'utf8');}
        catch (error) {if (error.code !== 'ENOENT') throw error; throw new Error('Configure primeiro o arquivo .env conforme .env.example.');}
        const line = 'NEWS_API_KEY=' + JSON.stringify(token);
        const next = /^NEWS_API_KEY=.*$/m.test(previous) ? previous.replace(/^NEWS_API_KEY=.*$/m, () => line) : previous.trimEnd() + '\n' + line + '\n';
        const temporary = path.join(root, '.env.news-tmp');
        await writeFile(temporary, next, {mode:0o600});
        await rename(temporary, filename);
        console.log('Chave salva. Reinicie o Comet para carregar as notícias.');
    }
} catch (error) {console.error(error instanceof Error ? error.message : 'Não foi possível salvar a chave.'); process.exitCode = 1;}
finally {input.close();}