import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { decodeHTML } from 'entities';

const excluded = new BlockList();
const excludedV6 = new BlockList();
const globalV6 = new BlockList();
globalV6.addSubnet('2000::',3,'ipv6');
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const) excluded.addSubnet(ip, prefix, 'ipv4');
for (const [ip, prefix] of [['::',96],['::ffff:0:0',96],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',23],['2001:db8::',32],['2002::',16],['fc00::',7],['fe80::',10],['ff00::',8]] as const) excludedV6.addSubnet(ip, prefix, 'ipv6');

export function publicAddress(address: string) {
    const version = isIP(address);
    return version === 4 ? !excluded.check(address, 'ipv4') : version === 6 && globalV6.check(address,'ipv6') && !excludedV6.check(address, 'ipv6');
}
export function publicURL(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 4096) return null;
    try {
        const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || /\.(local|localhost|internal|test|invalid)\.?$/.test(host)) return null;
        if (isIP(host) ? !publicAddress(host) : !host.includes('.') || host.endsWith('.')) return null;
        url.hash = '';
        return url.href;
    } catch { return null; }
}

export function pageText(html: string, plain = false): string {
    if (plain) return html.replace(/\s+/g, ' ').trim().slice(0, 16000);
    let content = html.replace(/<!--[\s\S]*?-->/g, ' ');
    for (const tag of ['script','style','noscript','svg','nav','footer','header','form','aside']) {
        content = content.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ');
    }
    const article = /<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)\s*>/i.exec(content);
    content = article?.[1] ?? content;
    return decodeHTML(content.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 16000);
}

async function documentResponse(url: URL, signal: AbortSignal) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{address:host, family:isIP(host)}] : await new Promise<Array<{address:string;family:number}>>((resolve,reject)=>{
        const cancel=()=>reject(signal.reason);
        signal.addEventListener('abort',cancel,{once:true});
        void lookup(host,{all:true}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
        if(signal.aborted)cancel();
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Endereço não público.');
    const address = addresses.find(item => item.family === 4) ?? addresses[0];
    return new Promise<{ status: number; location?: string; type: string; body: string }>((resolve, reject) => {
        // Pin the validated DNS result for this connection, including on every redirect.
        const req = request(url, {signal, agent:false, family:address.family, lookup:(_host, _options, callback) => callback(null, address.address, address.family), headers:{'User-Agent':'CometResearch/1.0', Accept:'text/html,application/xhtml+xml,text/plain', 'Accept-Encoding':'identity'}}, response => {
            const status = response.statusCode ?? 0, type = String(response.headers['content-type'] ?? '').split(';')[0].toLowerCase();
            if ([301,302,303,307,308].includes(status)) { response.destroy(); resolve({status,location:response.headers.location,type,body:''}); return; }
            if (status !== 200 || !['text/html','application/xhtml+xml','text/plain'].includes(type) || Number(response.headers['content-length']) > 768000 || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
                response.destroy(); reject(new Error('Página não legível.')); return;
            }
            const chunks: Buffer[] = []; let length = 0;
            response.on('data', (chunk: Buffer) => { length += chunk.length; if (length > 768000) response.destroy(new Error('Página muito grande.')); else chunks.push(chunk); });
            response.on('error', reject);
            response.on('end', () => resolve({status,type,body:Buffer.concat(chunks).toString('utf8')}));
        });
        req.on('error', reject); req.end();
    });
}

export async function readWebPage(value: string, parent: AbortSignal): Promise<string> {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(7000)]);
    let next = value;
    for (let redirect = 0; redirect <= 3; redirect++) {
        signal.throwIfAborted();
        const safe = publicURL(next);
        if (!safe) throw new Error('URL não pública.');
        const url = new URL(safe), response = await documentResponse(url, signal);
        if (response.location) { next = new URL(response.location, url).href; continue; }
        const text = pageText(response.body, response.type === 'text/plain');
        if (text.length < 180 || /just a moment|enable javascript and cookies|checking your browser|access denied/i.test(text.slice(0, 700))) throw new Error('Conteúdo indisponível.');
        return text;
    }
    throw new Error('Redirecionamentos demais.');
}
