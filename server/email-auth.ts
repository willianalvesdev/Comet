import { createHash, randomBytes, randomInt } from 'node:crypto';
import { cookie, equal, issueSession, normalizeEmail, sessionResponse, setCookie, signature } from './auth';
import { query, transaction } from './db';
import { sendLoginCode, emailTransport } from './email';
import { ApiError, json, readJson } from './http';
import { consumeRateLimit, rateLimit } from './rate-limit';

export const EMAIL_CHALLENGE_COOKIE = 'comet_email_challenge';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalidCode = () => new ApiError(422,'Código inválido ou expirado. Confira os seis dígitos ou solicite um novo.');
export async function requestEmailCode(request: Request) {
    const email = normalizeEmail((await readJson(request)).email);
    emailTransport().close();
    await rateLimit(request,'email-send',5);
    await rateLimit(request,'email-send-hour',30,undefined,3600);
    await consumeRateLimit('email-address-minute',email,1);
    await consumeRateLimit('email-address-hour',email,5,3600);
    const token = randomBytes(32).toString('hex'), code = String(randomInt(1000000)).padStart(6,'0');
    const tokenHash = digest(token);
    await transaction(async db => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['email:'+email]);
        await db.query('DELETE FROM auth_email_challenges WHERE email=$1 OR expires_at<=CURRENT_TIMESTAMP',[email]);
        await db.query(`INSERT INTO auth_email_challenges(token_hash,email,code_hash,expires_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP+INTERVAL '10 minutes')`,
            [tokenHash,email,signature('email-code:'+token+':'+code)]);
    });
    try { await sendLoginCode(email,code); }
    catch (error) {
        await query('DELETE FROM auth_email_challenges WHERE token_hash=$1',[tokenHash]);
        throw error;
    }
    const response = json({ok:true,retryAfter:60});
    setCookie(response,EMAIL_CHALLENGE_COOKIE,token,600);
    return response;
}
export async function verifyEmailCode(request: Request) {
    await rateLimit(request,'email-verify',20);
    const input = await readJson(request), code = input.code;
    const token = cookie(request,EMAIL_CHALLENGE_COOKIE);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(token)) throw invalidCode();
    const session = await transaction(async db => {
        const [challenge] = await db.query<{email:string;code_hash:string}>(`SELECT email,code_hash FROM auth_email_challenges
            WHERE token_hash=$1 AND expires_at>CURRENT_TIMESTAMP AND attempts<5 FOR UPDATE`,[digest(token)]);
        if (!challenge) return null;
        // Return the failure so the attempt counter commits instead of rolling back.
        await db.query('UPDATE auth_email_challenges SET attempts=attempts+1 WHERE token_hash=$1',[digest(token)]);
        if (!equal(challenge.code_hash,signature('email-code:'+token+':'+code))) return null;
        await db.query('DELETE FROM auth_email_challenges WHERE token_hash=$1',[digest(token)]);
        const [user] = await db.query<{id:string}>(`INSERT INTO usuarios(nome,email,email_verified_at) VALUES ($1,$2,CURRENT_TIMESTAMP)
            ON CONFLICT (lower(email)) DO UPDATE SET email_verified_at=CURRENT_TIMESTAMP RETURNING id`,
            [challenge.email.split('@')[0].slice(0,100),challenge.email]);
        return issueSession(db,request,user.id);
    });
    if (!session) throw invalidCode();
    const response = sessionResponse(session);
    setCookie(response,EMAIL_CHALLENGE_COOKIE,'',0);
    return response;
}
