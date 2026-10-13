import { createHash } from 'node:crypto';
import { query } from './db';
import { ApiError } from './http';

export async function consumeRateLimit(category: string, identity: string, maximum: number, seconds = 60) {
    const key = createHash('sha256').update(`${category}:${identity}`).digest('hex');
    const [row] = await query<{count:number}>(`INSERT INTO request_rate_limits (key,count,expires_at) VALUES ($1,1,CURRENT_TIMESTAMP+make_interval(secs=>$2))
        ON CONFLICT (key) DO UPDATE SET count=CASE WHEN request_rate_limits.expires_at<=CURRENT_TIMESTAMP THEN 1 ELSE request_rate_limits.count+1 END,
        expires_at=CASE WHEN request_rate_limits.expires_at<=CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP+make_interval(secs=>$2) ELSE request_rate_limits.expires_at END RETURNING count`,[key,seconds]);
    if (row.count > maximum) throw new ApiError(429,'Muitas tentativas. Aguarde e tente novamente.');
}
export async function rateLimit(request: Request, category: string, maximum: number, userId?: number, seconds = 60) {
    const proxy = process.env.TRUST_PROXY === 'true' ? (request.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0,128) : '';
    await consumeRateLimit(category,userId ? `user:${userId}` : proxy || 'local',maximum,seconds);
}
