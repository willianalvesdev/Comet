import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import { PDFParse } from 'pdf-parse';
import {query,closeDatabase} from '../../server/db';
import {packResponse} from '../../server/ai/types';
import {startNextServer} from '../frontend/next-server.cts';

test('produção: exportações autenticadas com os três formatos e recursos locais', {timeout:60000},async()=>{
    const session=randomBytes(32).toString('hex');let userId:string|undefined,server:Awaited<ReturnType<typeof startNextServer>>|undefined;
    try {
        const [user]=await query<{id:string}>('INSERT INTO usuarios (nome,email,senha,idade) VALUES ($1,$2,$3,30) RETURNING id',['Export test','exports-'+randomUUID()+'@example.com','test-only']);userId=user.id;
        await query("INSERT INTO sessoes(token_hash,usuario_id,expira_em) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",[createHash('sha256').update(session).digest('hex'),userId]);
        const [chat]=await query<{id:string}>('INSERT INTO computer_conversas (usuario_id,titulo) VALUES($1,$2) RETURNING id',[userId,'Pergunta de teste']);
        await query("INSERT INTO computer_mensagens (conversa_id,requisicao_id,pergunta,resposta,pensamento,estado) VALUES($1,$2,$3,$4,$5,'completed')",[chat.id,randomUUID(),'Como organizar o orçamento?','Registre as receitas e despesas. [1]',packResponse('Pensamento privado',{research:{sources:[{title:'Fonte de teste',url:'https://example.com/fontes'}]}})]);
        const [single] = await query<{id:string}>("INSERT INTO computer_mensagens (conversa_id,requisicao_id,pergunta,resposta,pensamento,estado) VALUES($1,$2,$3,$4,'','completed') RETURNING id",[chat.id,randomUUID(),'PERGUNTA INDIVIDUAL','RESPOSTA INDIVIDUAL']);
        server=await startNextServer(process.cwd());
        const url=server.origin+'/api/ai/conversations/'+chat.id+'/export';
        assert.equal((await fetch(url+'?format=pdf')).status,401);
        for(const [format,extension,type] of [['pdf','pdf','application/pdf'],['markdown','md','text/markdown'],['docx','docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
            const response=await fetch(url+'?format='+format,{headers:{cookie:'comet_session='+session}});
            assert.equal(response.status,200,await response.clone().text());assert(response.headers.get('content-type')?.startsWith(type));assert.match(response.headers.get('content-disposition') || '',new RegExp('\\.'+extension));
            const contents=Buffer.from(await response.arrayBuffer());assert(contents.length>100);if(format==='pdf')assert.equal(contents.subarray(0,5).toString(),'%PDF-');else if(format==='docx')assert.equal(contents.subarray(0,2).toString(),'PK');else{assert.match(contents.toString(),/## Fontes/);assert(!contents.toString().includes('Pensamento privado'));}
        }
        const one = await fetch(url+'?format=pdf&turn='+single.id,{headers:{cookie:'comet_session='+session}});
        assert.equal(one.status,200);
        const parser=new PDFParse({data:Buffer.from(await one.arrayBuffer())});
        try {const text=(await parser.getText()).text;assert.match(text,/PERGUNTA INDIVIDUAL/);assert.match(text,/RESPOSTA INDIVIDUAL/);assert(!text.includes('Como organizar o orçamento'));} finally {await parser.destroy();}
        assert.equal((await fetch(url+'?format=pdf&turn=9000000000000000000',{headers:{cookie:'comet_session='+session}})).status,404);
        assert.equal((await fetch(url+'?format=pdf&turn=invalid',{headers:{cookie:'comet_session='+session}})).status,422);
        assert.equal((await fetch(url+'?format=html',{headers:{cookie:'comet_session='+session}})).status,400);
        assert.equal((await fetch(server.origin+'/api/ai/conversations/9000000000000000000/export?format=pdf',{headers:{cookie:'comet_session='+session}})).status,404);
    } finally {await server?.stop();if(userId)await query('DELETE FROM usuarios WHERE id=$1',[userId]);await closeDatabase();}
});
