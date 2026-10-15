import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { GET, POST, PUT, PATCH } from '../../app/api/[...path]/route';
import { POST as signOut } from '../../app/logout/route';
import { closeDatabase, query } from '../../server/db';

const origin = 'http://localhost:5001';
const emails = [0,1].map(() => `routes-${randomUUID()}@example.com`);
const users: number[] = [];
class Client {
    cookies = new Map<string,string>();
    token = '';
    async call(path: string, method = 'GET', body?: BodyInit, type?: string, includeCSRF = true) {
        const headers = new Headers({cookie:[...this.cookies].map(([name,value]) => `${name}=${value}`).join('; '), origin});
        if (this.token && includeCSRF) headers.set('x-csrftoken',this.token);
        if (type) headers.set('content-type',type);
        const handlers = {GET,POST,PUT,PATCH};
        const response = await (path === '/logout' ? signOut : handlers[method as keyof typeof handlers])(new Request(origin+path,{method,headers,body}));
        for (const entry of response.headers.getSetCookie()) {
            const pair = entry.split(';')[0], at = pair.indexOf('=');
            this.cookies.set(pair.slice(0,at),pair.slice(at+1));
        }
        return response;
    }
    async bootstrap(page = 'index') {
        const response = await this.call('/api/bootstrap?page='+page);
        const data = await response.json();
        this.token = data.csrfToken;
        return data;
    }
}
after(async () => {
    for (const email of emails) await query('DELETE FROM usuarios WHERE email=$1',[email]);
    await closeDatabase();
});

test('API contracts preserve authorization, CSRF, account isolation and JSON errors', async () => {
    const first = new Client(), second = new Client();
    assert.equal((await first.call('/api/finance/chart')).status,401);
    assert.equal((await first.call('/api/ai/conversations')).status,401);
    assert.equal((await first.call('/api/auth/login','POST',new URLSearchParams())).status,400);
    for (const [index,client] of [first,second].entries()) {
        await client.bootstrap();
        const [user] = await query<{id:string}>('INSERT INTO usuarios(nome,email) VALUES ($1,$2) RETURNING id',['Pessoa teste',emails[index]]);
        const token = randomBytes(32).toString('hex');
        await query("INSERT INTO sessoes(token_hash,usuario_id,expira_em) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '10 minutes')",[createHash('sha256').update(token).digest('hex'),user.id]);
        client.cookies.set('comet_session',token);
        const data = await client.bootstrap('computer');
        assert.equal(data.user.email,emails[index]);
        assert.equal('senha' in data.user,false);
        users.push(data.user.id);
    }
    const payload = {external_id:randomUUID(),kind:'income',amount:'10.20',description:'Teste',occurred_on:'2026-01-01'};
    const response = await first.call('/api/finance/transactions','POST',JSON.stringify(payload),'application/json');
    assert.equal(response.status,201);
    const history = await (await first.call('/api/finance/transactions')).json();
    assert.equal(history.transactions.length,1);
    assert.equal(history.transactions[0].amount,'10.20');
    const otherHistory = await (await second.call('/api/finance/transactions')).json();
    assert.equal(otherHistory.transactions.length,0);
    const chart=await (await first.call('/api/finance/chart?period=max')).json();
    assert.equal(chart.series.balance.points.at(-1).close,10.2);
    const otherChart=await (await second.call('/api/finance/chart?period=max')).json();
    assert.deepEqual(otherChart.series.balance.points,[]);
    assert.equal(otherChart.summary.balance.amount,'0.00');
    assert.equal((await first.call('/api/finance/chart?period=invalid')).status,400);
    assert.equal((await first.call('/api/finance/transactions','POST',JSON.stringify(payload),'application/json')).status,200);
    assert.equal((await first.call('/api/finance/transactions','POST',JSON.stringify({...payload,amount:'20.40'}),'application/json')).status,409);
    assert.equal((await first.call('/api/finance/transactions','POST','{','application/json')).status,400);
    assert.equal((await first.call('/api/finance/transactions','POST','{}','application/json',false)).status,400);
    assert.equal((await first.call('/api/auth/login','POST','{}','application/json')).status,404);
    assert.equal((await first.call('/api/finance/chart','POST','{}','application/json')).status,405);
    assert.equal((await first.call('/api/unknown')).status,404);
    assert.equal((await first.call('/api/ai/conversations/0')).status,422);
    assert.equal((await first.call('/api/ai/conversations/99999999999')).status,404);
    assert.equal((await first.call('/api/bootstrap?page=invalid')).status,400);
    const profile = await (await first.call('/api/ai/personalization')).json();
    assert.ok(profile);
    const loggedOut = await first.call('/logout','POST');
    assert.equal(loggedOut.status,303);
    assert.equal((await first.call('/api/finance/chart')).status,401);
});
