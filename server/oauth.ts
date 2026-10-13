import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { cookie, equal, issueSession, normalizeEmail, sessionResponse, setCookie } from './auth';
import { query, transaction } from './db';
import { ApiError, json } from './http';
import { rateLimit } from './rate-limit';

type Provider = 'google' | 'github';
type Identity = { subject:string; email:string; name:string; authoritative:boolean };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
function providerName(value: string): Provider {
    if (value !== 'google' && value !== 'github') throw new ApiError(404,'Opção de entrada não encontrada.');
    return value;
}
export function authOrigin(): string {
    const configured = process.env.AUTH_ORIGIN || '';
    try {
        const url = new URL(configured);
        if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
            (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))))
            throw new Error('origin');
        return url.origin;
    } catch { throw new ApiError(503,'O endereço de autenticação ainda não foi configurado.'); }
}
function configuration(provider: Provider) {
    const clientId = process.env[provider.toUpperCase()+'_CLIENT_ID'];
    const clientSecret = process.env[provider.toUpperCase()+'_CLIENT_SECRET'];
    if (!clientId || !clientSecret) throw new ApiError(503,`O acesso com ${provider === 'google' ? 'Google' : 'GitHub'} ainda não foi configurado.`);
    return {clientId,clientSecret,redirectUri:authOrigin()+'/api/auth/'+provider+'/callback'};
}
async function providerJson(url: string, init: RequestInit = {}) {
    const response = await fetch(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('provider_failed');
    return response.json();
}
export async function validateGoogleToken(token: string, clientId: string, nonce: string, keys: JWTVerifyGetKey = googleKeys): Promise<Identity> {
    const {payload} = await jwtVerify(token,keys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,algorithms:['RS256'],maxTokenAge:'10m',requiredClaims:['exp','sub','email','email_verified','nonce']});
    if (typeof payload.nonce !== 'string' || !equal(payload.nonce,nonce) ||
        payload.email_verified !== true || !payload.sub || (payload.azp && payload.azp !== clientId))
        throw new Error('unverified_identity');
    const email = normalizeEmail(payload.email);
    return {subject:payload.sub,email,name:typeof payload.name === 'string' ? payload.name : email.split('@')[0],
        authoritative:email.endsWith('@gmail.com') || (typeof payload.hd === 'string' && payload.hd.length > 0)};
}
async function identity(provider: Provider, code: string, verifier: string, nonce: string): Promise<Identity> {
    const {clientId,clientSecret,redirectUri} = configuration(provider);
    const params = new URLSearchParams({client_id:clientId,client_secret:clientSecret,code,redirect_uri:redirectUri,code_verifier:verifier,grant_type:'authorization_code'});
    const token = await providerJson(provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token',
        {method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:params});
    if (provider === 'google') {
        if (typeof token.id_token !== 'string') throw new Error('invalid_token');
        return validateGoogleToken(token.id_token,clientId,nonce);
    }
    if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer') throw new Error('invalid_token');
    const headers = {Authorization:'Bearer '+token.access_token,Accept:'application/vnd.github+json','User-Agent':'Comet','X-GitHub-Api-Version':'2022-11-28'};
    const profile = await providerJson('https://api.github.com/user',{headers});
    const emails = await providerJson('https://api.github.com/user/emails',{headers});
    const verified = Array.isArray(emails) ? emails.find(item => item.primary === true && item.verified === true) : null;
    if (!Number.isSafeInteger(profile.id) || profile.id <= 0 || !verified) throw new Error('unverified_identity');
    const email = normalizeEmail(verified.email);
    return {subject:String(profile.id),email,name:typeof profile.name === 'string' ? profile.name : String(profile.login || email.split('@')[0]),authoritative:true};
}
export async function startOAuth(request: Request, value: string) {
    const provider = providerName(value), config = configuration(provider);
    await rateLimit(request,'oauth-start',10);
    const state = randomBytes(32).toString('hex'), verifier = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('hex');
    await query('DELETE FROM auth_oauth_states WHERE expires_at<=CURRENT_TIMESTAMP');
    await query(`INSERT INTO auth_oauth_states(state_hash,provider,verifier,nonce,expires_at) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP+INTERVAL '10 minutes')`,
        [hash(state),provider,verifier,nonce]);
    const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
        client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',state,
        scope:provider === 'google' ? 'openid email profile' : 'read:user user:email',
        code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',
        ...(provider === 'google' ? {nonce,prompt:'select_account'} : {}),
    }).toString();
    const response = json({url:url.href});
    setCookie(response,'comet_oauth_'+provider,state,600);
    return response;
}
function redirectFailure(provider: Provider, reason = 'oauth') {
    const response = new Response(null,{status:303,headers:{Location:'/?login=1&auth_error='+reason,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    setCookie(response,'comet_oauth_'+provider,'',0);
    return response;
}
export async function finishOAuth(request: Request, value: string) {
    const provider = providerName(value);
    try {
        const params = new URL(request.url).searchParams, state = params.get('state') || '';
        if (!/^[a-f0-9]{64}$/.test(state) || !equal(state,cookie(request,'comet_oauth_'+provider))) return redirectFailure(provider);
        const [pending] = await query<{verifier:string;nonce:string}>(`DELETE FROM auth_oauth_states
            WHERE state_hash=$1 AND provider=$2 AND expires_at>CURRENT_TIMESTAMP RETURNING verifier,nonce`,[hash(state),provider]);
        const code = params.get('code');
        if (!pending || params.has('error') || !code || code.length > 4096) return redirectFailure(provider);
        const profile = await identity(provider,code,pending.verifier,pending.nonce);
        const session = await transaction(async db => {
            await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['oauth:'+provider+':'+profile.subject]);
            const [known] = await db.query<{usuario_id:string}>('SELECT usuario_id FROM auth_identities WHERE provider=$1 AND subject=$2',[provider,profile.subject]);
            if (known) return issueSession(db,request,known.usuario_id);
            // Never attach an external identity to an existing account just because emails match.
            if (!profile.authoritative) return null;
            const [user] = await db.query<{id:string}>(`INSERT INTO usuarios(nome,email,email_verified_at) VALUES ($1,$2,CURRENT_TIMESTAMP)
                ON CONFLICT (lower(email)) DO NOTHING RETURNING id`,
                [profile.name.replace(/[\x00-\x1f]/g,'').trim().slice(0,100) || profile.email.split('@')[0],profile.email]);
            if (!user) return null;
            await db.query('INSERT INTO auth_identities(provider,subject,usuario_id) VALUES ($1,$2,$3)',[provider,profile.subject,user.id]);
            return issueSession(db,request,user.id);
        });
        if (!session) return redirectFailure(provider,'email');
        const response = sessionResponse(session);
        response.headers.set('Location','/principal.html');
        response.headers.set('Referrer-Policy','no-referrer');
        setCookie(response,'comet_oauth_'+provider,'',0);
        return new Response(null,{status:303,headers:response.headers});
    } catch {
        // Provider errors may contain tokens; expose only the fixed retry message.
        return redirectFailure(provider);
    }
}
