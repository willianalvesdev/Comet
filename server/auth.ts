import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import validator from 'validator';
import { query } from './db';
import type { Database } from './db';
import { ApiError, json } from './http';

export interface User { id: number; nome: string; email: string }
export const SESSION_COOKIE = 'comet_session';
const CSRF_COOKIE = 'comet_csrf';
const lifetime = 30 * 24 * 60 * 60;
export function cookie(request: Request, name: string): string {
    for (const part of (request.headers.get('cookie') || '').split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) return value.join('=');
    }
    return '';
}
function secret(): string {
    const value = process.env.SECRET_KEY || '';
    if (value.length < 32 || value.startsWith('gere-')) throw new Error('SECRET_KEY não configurada.');
    return value;
}
export function signature(value: string): string { return createHmac('sha256', secret()).update(value).digest('hex'); }
export function equal(a: string, b: string): boolean {
    const left = Buffer.from(a), right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
export function setCookie(response: Response, name: string, value: string, maxAge = lifetime) {
    const secure = (process.env.SESSION_COOKIE_SECURE === 'true' || process.env.AUTH_ORIGIN?.startsWith('https://')) ? '; Secure' : '';
    response.headers.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
function validCSRF(token: string, session: string): boolean {
    const [nonce, mac, extra] = token.split('.');
    return !extra && /^[a-f\d]{64}$/.test(nonce || '') && /^[a-f\d]{64}$/.test(mac || '') && equal(signature(`${nonce}:${session}`),mac);
}
export function csrfToken(request: Request): string {
    const existing = cookie(request, CSRF_COOKIE), session = cookie(request, SESSION_COOKIE);
    if (validCSRF(existing, session)) return existing;
    const nonce = randomBytes(32).toString('hex');
    return `${nonce}.${signature(`${nonce}:${session}`)}`;
}
export async function verifyCSRF(request: Request): Promise<void> {
    const origin = request.headers.get('origin');
    const expected = new URL(request.url);
    const trustedProxy = process.env.TRUST_PROXY === 'true';
    const host = (trustedProxy ? request.headers.get('x-forwarded-host') : null) || request.headers.get('host');
    if (host) expected.host = host;
    const protocol = trustedProxy ? request.headers.get('x-forwarded-proto') : null;
    if (protocol === 'http' || protocol === 'https') expected.protocol = protocol + ':';
    if (origin && origin !== expected.origin) throw new ApiError(403, 'Origem da solicitação inválida.');
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403,'Origem da solicitação inválida.');
    let token = request.headers.get('x-csrftoken') || request.headers.get('x-csrf-token') || '';
    if (!token && /(?:application\/x-www-form-urlencoded|multipart\/form-data)/i.test(request.headers.get('content-type') || '')) {
        try { token = String((await request.clone().formData()).get('csrf_token') || ''); } catch { /* invalid form */ }
    }
    if (!token || !equal(token, cookie(request, CSRF_COOKIE)) || !validCSRF(token,cookie(request,SESSION_COOKIE)))
        throw new ApiError(400, 'O formulário expirou. Atualize a página e tente novamente.');
}
export async function currentUser(request: Request): Promise<User | null> {
    const token = cookie(request, SESSION_COOKIE);
    if (!/^[a-f\d]{64}$/.test(token)) return null;
    const rows = await query<{id:string;nome:string;email:string}>('SELECT u.id,u.nome,u.email FROM usuarios u JOIN sessoes s ON s.usuario_id=u.id WHERE s.token_hash=$1 AND s.expira_em>CURRENT_TIMESTAMP', [createHash('sha256').update(token).digest('hex')]);
    if (!rows.length) return null;
    return {...rows[0], id:Number(rows[0].id)};
}
export async function requireUser(request: Request): Promise<User> {
    const user = await currentUser(request);
    if (!user) throw new ApiError(401,'Entre novamente para acessar sua conta.','unauthorized');
    return user;
}
export async function bootstrap(request: Request): Promise<Response> {
    const page = new URL(request.url).searchParams.get('page') || 'computer';
    if (!['index','privacidade','computer','recentes','descobrir','aprender','graficos'].includes(page)) throw new ApiError(400,'Página inválida.');
    const user = await currentUser(request);
    if (!user && page !== 'index' && page !== 'privacidade') throw new ApiError(401,'Entre novamente para acessar sua conta.');
    const token = csrfToken(request);
    const response = json({page,activePage:page,user,csrfToken:token,currentYear:new Date().getUTCFullYear()});
    setCookie(response, CSRF_COOKIE, token);
    return response;
}
export function normalizeEmail(value: unknown): string {
    if (typeof value !== 'string' || value.length > 254) throw new ApiError(422,'Informe um e-mail válido.');
    const email = value.trim().normalize('NFC').toLowerCase();
    if (!validator.isEmail(email,{allow_utf8_local_part:true, require_tld:true})) throw new ApiError(422,'Informe um e-mail válido.');
    return email;
}
export async function issueSession(db: Database, request: Request, userId: string | number) {
    const old = cookie(request, SESSION_COOKIE), token = randomBytes(32).toString('hex');
    if (old) await db.query('DELETE FROM sessoes WHERE token_hash=$1',[createHash('sha256').update(old).digest('hex')]);
    await db.query('DELETE FROM sessoes WHERE usuario_id=$1 AND expira_em<=CURRENT_TIMESTAMP',[userId]);
    await db.query("INSERT INTO sessoes (token_hash,usuario_id,expira_em) VALUES ($1,$2,CURRENT_TIMESTAMP+INTERVAL '30 days')",[createHash('sha256').update(token).digest('hex'),userId]);
    return token;
}
export function sessionResponse(token: string, status = 200) {
    const response = json({ok:true},status);
    setCookie(response,SESSION_COOKIE,token);
    setCookie(response,CSRF_COOKIE,'',0);
    return response;
}
export async function logout(request: Request): Promise<Response> {
    const token = cookie(request,SESSION_COOKIE);
    if (token) await query('DELETE FROM sessoes WHERE token_hash=$1',[createHash('sha256').update(token).digest('hex')]);
    const response = new Response(null,{status:303,headers:{Location:'/', 'Cache-Control':'no-store'}});
    setCookie(response,SESSION_COOKIE,'',0); setCookie(response,CSRF_COOKIE,'',0);
    return response;
}
