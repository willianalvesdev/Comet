import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authOrigin, finishOAuth, startOAuth, validateGoogleToken } from '../../server/oauth';
import { currentUser } from '../../server/auth';
import { query, closeDatabase } from '../../server/db';
import { ApiError } from '../../server/http';

const origin='http://127.0.0.1:5001';
const emails:string[]=[],states:string[]=[],ips:string[]=[];
let subject=0, email='', verified=true, failProvider=false, exchanges=0, lastVerifier='';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function account() {email='oauth-'+randomUUID()+'@example.com';emails.push(email);subject=100000+emails.length;verified=true;return email;}
async function begin(provider='github') {
    const ip='198.51.100.'+(10+ips.length);ips.push(ip);
    const response = await startOAuth(new Request(origin,{headers:{'X-Forwarded-For':ip}}),provider);
    const data=await response.json(), url=new URL(data.url), state=url.searchParams.get('state')!;states.push(hash(state));
    return {response,url,state,jar:response.headers.getSetCookie().map(item=>item.split(';')[0]).join('; ')};
}
async function finish(flow: Awaited<ReturnType<typeof begin>>, provider='github') {
    return finishOAuth(new Request(origin+'/api/auth/'+provider+'/callback?state='+flow.state+'&code=provider-code',{headers:{cookie:flow.jar}}),provider);
}
before(()=>{
    Object.assign(process.env,{AUTH_ORIGIN:origin,GITHUB_CLIENT_ID:'client',GITHUB_CLIENT_SECRET:'secret',GOOGLE_CLIENT_ID:'google-client',GOOGLE_CLIENT_SECRET:'secret',TRUST_PROXY:'true'});
    mock.method(globalThis,'fetch',async (input: string|URL|Request, init?:RequestInit)=>{
        const url=String(input);
        if(failProvider) throw new Error('confidential-provider-token');
        if(url==='https://github.com/login/oauth/access_token') {
            exchanges++;lastVerifier=new URLSearchParams(String(init?.body)).get('code_verifier') || '';
            return Response.json({access_token:'test-provider-token',token_type:'bearer'});
        }
        if(url==='https://api.github.com/user') return Response.json({id:subject,login:'teste',name:'Pessoa Teste'});
        if(url==='https://api.github.com/user/emails') return Response.json([{email,primary:true,verified}]);
        throw new Error('Unexpected outbound URL: '+url);
    });
});
after(async ()=>{
    mock.restoreAll();
    for(const address of emails) await query('DELETE FROM usuarios WHERE email=$1',[address]);
    await query('DELETE FROM auth_oauth_states WHERE state_hash=ANY($1::text[])',[states]);
    await query('DELETE FROM request_rate_limits WHERE key=ANY($1::text[])',[ips.map(ip=>hash('oauth-start:'+ip))]);
    await closeDatabase();
});
test('OAuth starts use state, PKCE S256, fixed callback, and minimal identity scopes',async ()=>{
    for(const provider of ['google','github']) {
        const flow=await begin(provider);
        assert.match(flow.state,/^[a-f0-9]{64}$/);
        assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');
        assert.equal(flow.url.searchParams.get('redirect_uri'),origin+'/api/auth/'+provider+'/callback');
        assert.equal(flow.url.searchParams.get('scope'),provider==='google'?'openid email profile':'read:user user:email');
        const [row]=await query<{verifier:string;nonce:string}>('SELECT verifier,nonce FROM auth_oauth_states WHERE state_hash=$1',[hash(flow.state)]);
        assert.equal(flow.url.searchParams.get('code_challenge'),createHash('sha256').update(row.verifier).digest('base64url'));
        if(provider==='google') assert.equal(flow.url.searchParams.get('nonce'),row.nonce);
        assert.ok(flow.response.headers.getSetCookie()[0].includes('HttpOnly'));
        assert.equal(flow.url.searchParams.get('client_secret'),null);
    }
});
test('GitHub signs in with verified email and reuses only its stable provider subject',async ()=>{
    const address=account(), flow=await begin(), response=await finish(flow);
    assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/principal.html');assert.match(lastVerifier,/^[\w-]{43}$/);
    const jar=response.headers.getSetCookie().map(item=>item.split(';')[0]).join('; ');
    const firstUser=await currentUser(new Request(origin,{headers:{cookie:jar}}));assert.equal(firstUser?.email,address);
    email='changed-'+randomUUID()+'@example.com';
    const again=await finish(await begin());
    const secondUser=await currentUser(new Request(origin,{headers:{cookie:again.headers.getSetCookie().map(item=>item.split(';')[0]).join('; ')}}));
    assert.equal(secondUser?.id,firstUser!.id);
});
test('state is browser-bound, expires, and cannot be replayed or used for another provider',async ()=>{
    account();const flow=await begin(), beforeCount=exchanges;
    const missing=await finishOAuth(new Request(origin+'/api/auth/github/callback?state='+flow.state+'&code=test'),'github');
    assert.match(missing.headers.get('Location')!,/auth_error=oauth/);assert.equal(exchanges,beforeCount);
    const mixed=await finish(flow,'google');assert.match(mixed.headers.get('Location')!,/auth_error=oauth/);
    assert.equal((await finish(flow)).headers.get('Location'),'/principal.html');
    const calls=exchanges;assert.match((await finish(flow)).headers.get('Location')!,/auth_error=oauth/);assert.equal(exchanges,calls);
    const expired=await begin();await query("UPDATE auth_oauth_states SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE state_hash=$1",[hash(expired.state)]);
    assert.match((await finish(expired)).headers.get('Location')!,/auth_error=oauth/);assert.equal(exchanges,calls);
});
test('unverified GitHub email creates no account',async ()=>{
    const address=account();verified=false;
    assert.match((await finish(await begin())).headers.get('Location')!,/auth_error=oauth/);
    assert.equal((await query('SELECT id FROM usuarios WHERE email=$1',[address])).length,0);
});
test('matching email cannot silently attach a provider to an existing account',async ()=>{
    const address=account();await query('INSERT INTO usuarios(nome,email) VALUES($1,$2)',['Existing',address]);
    const response=await finish(await begin());
    assert.match(response.headers.get('Location')!,/auth_error=email/);
    assert.ok(!response.headers.getSetCookie().some(item=>item.startsWith('comet_session=')));
    assert.equal((await query('SELECT * FROM auth_identities WHERE provider=$1 AND subject=$2',['github',String(subject)])).length,0);
});
test('provider failures redirect safely and do not expose tokens',async ()=>{
    account();const flow=await begin();failProvider=true;
    try {const response=await finish(flow);assert.equal(response.headers.get('Location'),'/?login=1&auth_error=oauth');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');}
    finally {failProvider=false;}
});
test('OAuth requires configured credentials and a fixed HTTPS or loopback origin',async ()=>{
    const client=process.env.GOOGLE_CLIENT_ID;delete process.env.GOOGLE_CLIENT_ID;
    try {await assert.rejects(startOAuth(new Request(origin),'google'),error=>error instanceof ApiError && error.status===503);}
    finally {process.env.GOOGLE_CLIENT_ID=client;}
    for(const invalid of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/?next=evil']){
        process.env.AUTH_ORIGIN=invalid;assert.throws(authOrigin);
    }
    process.env.AUTH_ORIGIN=origin;assert.equal(authOrigin(),origin);
});
test('Google ID tokens validate signature, audience, issuer, expiry, nonce and verified email',async ()=>{
    const {publicKey,privateKey}=await generateKeyPair('RS256');
    const jwk=await exportJWK(publicKey);jwk.kid='test-key';
    const keys=createLocalJWKSet({keys:[jwk]});
    const claims={nonce:'nonce',email:'test@gmail.com',email_verified:true,name:'Test'};
    async function token(values:Record<string,unknown>={}) {
        return new SignJWT({...claims,...values}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('google-subject').setIssuer('https://accounts.google.com').setAudience('client').setIssuedAt().setExpirationTime('10m').sign(privateKey);
    }
    assert.equal((await validateGoogleToken(await token(),'client','nonce',keys)).authoritative,true);
    const outside=await validateGoogleToken(await token({email:'test@example.com'}),'client','nonce',keys);assert.equal(outside.authoritative,false);
    assert.equal((await validateGoogleToken(await token({email:'test@example.com',hd:'example.com'}),'client','nonce',keys)).authoritative,true);
    await assert.rejects(validateGoogleToken(await token(),'other-client','nonce',keys));
    await assert.rejects(validateGoogleToken(await token(),'client','other-nonce',keys));
    await assert.rejects(validateGoogleToken(await token({email_verified:false}),'client','nonce',keys));
    await assert.rejects(validateGoogleToken(await token({azp:'another-client'}),'client','nonce',keys));
    const expired=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('google-subject').setIssuer('https://accounts.google.com').setAudience('client').setIssuedAt().setExpirationTime(1).sign(privateKey);
    await assert.rejects(validateGoogleToken(expired,'client','nonce',keys));
    const wrongIssuer=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('google-subject').setIssuer('https://attacker.example').setAudience('client').setIssuedAt().setExpirationTime('10m').sign(privateKey);
    await assert.rejects(validateGoogleToken(wrongIssuer,'client','nonce',keys));
    const other=await generateKeyPair('RS256');const forged=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('google-subject').setIssuer('https://accounts.google.com').setAudience('client').setIssuedAt().setExpirationTime('10m').sign(other.privateKey);
    await assert.rejects(validateGoogleToken(forged,'client','nonce',keys));
});
