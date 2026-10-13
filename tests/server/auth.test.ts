import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { bootstrap, cookie, csrfToken, currentUser, logout, normalizeEmail, SESSION_COOKIE, verifyCSRF } from '../../server/auth';
import { EMAIL_CHALLENGE_COOKIE, requestEmailCode, verifyEmailCode } from '../../server/email-auth';
import { emailTransport } from '../../server/email';
import { ApiError, boundedRequest, readJson } from '../../server/http';
import { query, closeDatabase } from '../../server/db';
import { rateLimit } from '../../server/rate-limit';

const origin = 'http://localhost:5001';
const status = (expected: number) => (error: unknown) => error instanceof ApiError && error.status === expected;
const emails: string[] = [], ips: string[] = [];
const delivered = new Map<string,string>();
let failDelivery = false;
function address() {const email = `auth-${randomUUID()}@example.com`;emails.push(email);return email;}
function request(data: unknown, cookies = '') {
    const ip = '192.0.2.'+(10+ips.length);ips.push(ip);
    return new Request(origin+'/api/auth/email/request',{method:'POST',headers:{origin,cookie:cookies,'Content-Type':'application/json','X-Forwarded-For':ip},body:JSON.stringify(data)});
}
function cookies(response: Response) {return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');}
async function send(email: string) {return requestEmailCode(request({email}));}
async function expireCooldown(email: string) {
    await query("UPDATE request_rate_limits SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE key=$1",[createHash('sha256').update('email-address-minute:'+email).digest('hex')]);
}
before(() => {
    process.env.TRUST_PROXY = 'true';
    Object.assign(process.env,{SMTP_HOST:'smtp.example.com',SMTP_USER:'test',SMTP_PASSWORD:'test',EMAIL_FROM:'comet@example.com'});
    mock.method(nodemailer,'createTransport',(() => ({
        async sendMail(message: {to:string;text:string}) {
            if (failDelivery) throw new Error('SMTP failure with confidential details');
            const code = message.text.match(/\b(\d{6})\b/)?.[1];assert.ok(code);
            delivered.set(message.to,code);
            return {accepted:[message.to]};
        }, close() {},
    })) as unknown as typeof nodemailer.createTransport);
});
after(async () => {
    mock.restoreAll();
    for (const email of emails) {
        await query('DELETE FROM usuarios WHERE email=$1',[email]);
        await query('DELETE FROM auth_email_challenges WHERE email=$1',[email]);
    }
    const keys = [
        ...emails.flatMap(email => ['email-address-minute','email-address-hour'].map(category => createHash('sha256').update(category+':'+email).digest('hex'))),
        ...ips.flatMap(ip => ['email-send','email-send-hour','email-verify'].map(category => createHash('sha256').update(category+':'+ip).digest('hex'))),
    ];
    await query('DELETE FROM request_rate_limits WHERE key=ANY($1::text[])',[keys]);
    await closeDatabase();
});

test('CSRF rejects missing, forged, cross-origin and session-swapped tokens', async () => {
    const token = csrfToken(new Request(origin)), jar = 'comet_csrf='+token;
    await verifyCSRF(new Request('http://localhost:3000/api/auth/email/request',{method:'POST',headers:{cookie:jar,'x-csrftoken':token,host:'127.0.0.1:5001',origin:'http://127.0.0.1:5001'}}));
    process.env.TRUST_PROXY = 'false';
    await assert.rejects(verifyCSRF(new Request(origin,{method:'POST',headers:{cookie:jar,'x-csrftoken':token,host:'localhost:5001',origin:'https://attacker.example','x-forwarded-host':'attacker.example','x-forwarded-proto':'https'}})),status(403));
    process.env.TRUST_PROXY = 'true';
    for (const value of ['', 'é'.repeat(token.length)]) await assert.rejects(verifyCSRF(new Request(origin,{method:'POST',headers:{cookie:jar,'x-csrftoken':value}})),status(400));
    await assert.rejects(verifyCSRF(new Request(origin,{method:'POST',headers:{cookie:jar+'; '+SESSION_COOKIE+'='+'a'.repeat(64),'x-csrftoken':token}})),status(400));
    await assert.rejects(verifyCSRF(new Request(origin,{method:'POST',headers:{cookie:jar,'x-csrftoken':token,'sec-fetch-site':'cross-site'}})),status(403));
});
test('request limits reject chunked oversized bodies and malformed JSON', async () => {
    const bytes = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new Uint8Array(4));controller.enqueue(new Uint8Array(4));controller.close();}});
    await assert.rejects(boundedRequest(new Request(origin,{method:'POST',body:bytes,duplex:'half'} as RequestInit),7),status(413));
    assert.equal(await (await boundedRequest(new Request(origin,{method:'POST',body:'1234567'}),7)).text(),'1234567');
    await assert.rejects(readJson(new Request(origin,{method:'POST',body:'{}'})),status(415));
    await assert.rejects(readJson(request([])),status(400));
});
test('email codes are hashed, browser-bound, single-use and create accounts without age/password', async () => {
    const email = address(), sent = await send(email), jar = cookies(sent), code = delivered.get(email)!;
    assert.equal(sent.status,200);
    assert.match(sent.headers.getSetCookie()[0],/HttpOnly.*SameSite=Lax/);
    assert.deepEqual(await sent.json(),{ok:true,retryAfter:60});
    assert.equal((await query('SELECT id FROM usuarios WHERE email=$1',[email])).length,0);
    const [challenge] = await query<{code_hash:string}>('SELECT code_hash FROM auth_email_challenges WHERE email=$1',[email]);
    assert.match(challenge.code_hash,/^[a-f0-9]{64}$/);assert.notEqual(challenge.code_hash,code);
    await assert.rejects(verifyEmailCode(request({code})),status(422));
    const verified = await verifyEmailCode(request({code},jar));
    const user = await currentUser(new Request(origin,{headers:{cookie:cookies(verified)}}));
    assert.equal(user?.email,email);
    const [stored] = await query<{idade:number|null;senha:string|null;email_verified_at:Date}>('SELECT idade,senha,email_verified_at FROM usuarios WHERE email=$1',[email]);
    assert.equal(stored.idade,null);assert.equal(stored.senha,null);assert.ok(stored.email_verified_at);
    await assert.rejects(verifyEmailCode(request({code},jar)),status(422));
});
test('five wrong attempts lock the challenge even if the next code is correct', async () => {
    const email = address(), jar = cookies(await send(email)), code = delivered.get(email)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i=0;i<5;i++) await assert.rejects(verifyEmailCode(request({code:wrong},jar)),status(422));
    await assert.rejects(verifyEmailCode(request({code},jar)),status(422));
    const [row] = await query<{attempts:number}>('SELECT attempts FROM auth_email_challenges WHERE email=$1',[email]);assert.equal(row.attempts,5);
});
test('expired challenges cannot sign in', async () => {
    const email = address(), jar = cookies(await send(email));
    await query("UPDATE auth_email_challenges SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE email=$1",[email]);
    await assert.rejects(verifyEmailCode(request({code:delivered.get(email)},jar)),status(422));
});
test('resend has a cooldown and invalidates the previous code and browser token', async () => {
    const email = address(), oldJar = cookies(await send(email)), oldCode = delivered.get(email)!;
    await assert.rejects(send(email),status(429));
    await expireCooldown(email);
    const newJar = cookies(await send(email));
    await assert.rejects(verifyEmailCode(request({code:oldCode},oldJar)),status(422));
    assert.equal((await verifyEmailCode(request({code:delivered.get(email)},newJar))).status,200);
});
test('a concurrent code replay issues only one session', async () => {
    const email = address(), jar = cookies(await send(email)), code = delivered.get(email)!;
    const results = await Promise.allSettled([verifyEmailCode(request({code},jar)),verifyEmailCode(request({code},jar))]);
    assert.equal(results.filter(value=>value.status==='fulfilled').length,1);
});
test('existing accounts retain identity, rotate session and revoke logout', async () => {
    const email = address(), first = await verifyEmailCode(request({code:delivered.get(email) || ''},'')).catch(()=>null);
    assert.equal(first,null);
    const firstJar = cookies(await send(email));
    const initial = cookies(await verifyEmailCode(request({code:delivered.get(email)},firstJar)));
    const initialUser = await currentUser(new Request(origin,{headers:{cookie:initial}}));
    await expireCooldown(email);
    const secondJar = cookies(await send(email))+'; '+initial;
    const second = await verifyEmailCode(request({code:delivered.get(email)},secondJar));
    assert.equal(await currentUser(new Request(origin,{headers:{cookie:initial}})),null);
    const authenticated = new Request(origin+'/api/bootstrap?page=computer',{headers:{cookie:cookies(second)}});
    const data = await (await bootstrap(authenticated)).json();
    assert.equal(data.user.id,initialUser!.id);assert.ok(data.csrfToken);
    assert.equal((await logout(authenticated)).status,303);
    assert.equal(await currentUser(authenticated),null);
    await assert.rejects(bootstrap(authenticated),status(401));
});
test('mail failures expose no secrets and remove unusable challenges', async () => {
    const email = address();failDelivery = true;
    try {await assert.rejects(send(email),error => status(503)(error) && !String(error).includes('confidential'));}
    finally {failDelivery=false;}
    assert.equal((await query('SELECT * FROM auth_email_challenges WHERE email=$1',[email])).length,0);
});
test('missing SMTP settings do not create a challenge or pretend to send', async () => {
    const saved = process.env.SMTP_PASSWORD;delete process.env.SMTP_PASSWORD;
    try {assert.throws(emailTransport,status(503)); await assert.rejects(send(address()),status(503));}
    finally {process.env.SMTP_PASSWORD=saved;}
});
test('rate limiting counts simultaneous attempts atomically', async () => {
    const category='test-'+randomUUID(), req=new Request(origin);
    const results = await Promise.allSettled(Array.from({length:6},()=>rateLimit(req,category,3)));
    assert.equal(results.filter(value=>value.status==='fulfilled').length,3);
    assert.equal(results.filter(value=>value.status==='rejected' && status(429)(value.reason)).length,3);
    await query('DELETE FROM request_rate_limits WHERE key=$1',[createHash('sha256').update(category+':local').digest('hex')]);
});
test('email validation rejects whitespace, multiple addresses and invalid domains', () => {
    assert.equal(normalizeEmail(' Teste@Example.COM '),'teste@example.com');
    for (const value of ['', 'x','a@b','a@example.com,b@example.com','a b@example.com']) assert.throws(()=>normalizeEmail(value),status(422));
});
