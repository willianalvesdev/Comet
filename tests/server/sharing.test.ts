import {test, after, before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {query,closeDatabase} from '../../server/db';
import {getConversation,getConversationArtifact,beginTurn,changeConversation,getConversationExport} from '../../server/ai/conversations';
import {sharingInfo,changeSharing,addMember,removeMember,requestAccess,decideRequest,forkConversation,sharedAttachment} from '../../server/ai/sharing';
import {attachmentPath,readAttachment,removeAttachment} from '../../server/ai/attachments';
import {packMessage,packResponse,unpackMessage} from '../../server/ai/types';
if(process.env.TEST_DATABASE_URL)process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const configured=Boolean(process.env.DATABASE_URL),directory=path.resolve('artifacts','sharing-tests-'+randomUUID()),oldDirectory=process.env.ATTACHMENTS_DIR;
before(async()=>{if(configured){process.env.ATTACHMENTS_DIR=directory;await mkdir(directory,{recursive:true});}});
after(async()=>{await closeDatabase();process.env.ATTACHMENTS_DIR=oldDirectory;await rm(directory,{recursive:true,force:true});});
async function fixture(run:(owner:number,viewer:number,third:number,cid:string,emails:string[])=>Promise<void>){
 const users:number[]=[],emails:string[]=[];
 try{for(let i=0;i<3;i++){const email='sharing-'+randomUUID()+'@example.invalid';emails.push(email);const [u]=await query<{id:string}>('INSERT INTO usuarios(nome,email,senha,idade) VALUES($1,$2,$3,25) RETURNING id',['Sharing test '+i,email,'test-only']);users.push(Number(u.id));}
 const [c]=await query<{id:string}>('INSERT INTO computer_conversas(usuario_id,titulo) VALUES($1,$2) RETURNING id',[users[0],'Compartilhamento de teste']);
 await query("INSERT INTO computer_mensagens(conversa_id,requisicao_id,pergunta,resposta,pensamento,estado) VALUES($1,$2,$3,$4,'','completed')",[c.id,randomUUID(),'Mensagem original','Resposta original']);
 await run(users[0],users[1],users[2],String(c.id),emails);
 }finally{if(users.length)await query('DELETE FROM usuarios WHERE id=ANY($1::bigint[])',[users]);}
}
test('sharing PostgreSQL: restricted/public/revoked, grants, requests and owner mutations',{skip:!configured},async()=>fixture(async(owner,viewer,third,cid,emails)=>{
 await assert.rejects(getConversation(viewer,cid,null),{status:403,code:'conversation_private'});await assert.rejects(getConversation(0,cid,null),{status:403});
 const own=await getConversation(owner,cid,null);assert.equal(own.conversation.is_owner,true);assert.equal(own.conversation.id,cid);
 assert.equal((await sharingInfo(owner,cid)).access,'restricted');
 await assert.rejects(changeSharing(viewer,cid,'public'),{status:404});await assert.rejects(changeSharing(owner,cid,'unknown'),{status:422});
 await changeSharing(owner,cid,'public');const publicView=await getConversation(viewer,cid,null);assert.equal(publicView.conversation.shared,true);assert.equal(publicView.conversation.is_owner,false);assert.equal(publicView.turns[0].answer,'Resposta original');assert.equal((await getConversation(0,cid,null)).turns.length,1);
 await assert.rejects(changeConversation(viewer,cid,'Changed',false),{status:404});await assert.rejects(changeConversation(viewer,cid,null,true),{status:404});await assert.rejects(getConversationExport(viewer,cid),{status:404});
 await assert.rejects(beginTurn(viewer,{conversation_id:cid,message:'Modify',request_id:randomUUID(),provider:'qwen',attachments:[]}),{status:404});
 await changeSharing(owner,cid,'restricted');await assert.rejects(getConversation(viewer,cid,null),{status:403});
 await requestAccess(viewer,cid);await requestAccess(viewer,cid);let state=await sharingInfo(owner,cid);assert.equal(state.requests?.length,1);assert.equal((await sharingInfo(viewer,cid)).requested,true);
 await assert.rejects(decideRequest(third,cid,String(viewer),true),{status:404});await decideRequest(owner,cid,String(viewer),false);assert.equal((await sharingInfo(owner,cid)).requests?.length,0);
 await requestAccess(viewer,cid);await decideRequest(owner,cid,String(viewer),true);assert.equal((await getConversation(viewer,cid,null)).turns.length,1);await assert.rejects(getConversation(third,cid,null),{status:403});
 await removeMember(owner,cid,String(viewer));await assert.rejects(getConversation(viewer,cid,null),{status:403});
 await addMember(owner,cid,'missing-'+randomUUID()+'@example.invalid');const pending=(await sharingInfo(owner,cid)).members!.find(m=>m.id.startsWith('invite-'))!;assert.ok(pending);await removeMember(owner,cid,pending.id);await addMember(owner,cid,emails[1]);await addMember(owner,cid,emails[1]);state=await sharingInfo(owner,cid);assert.equal(state.members?.length,1);assert.equal((await sharingInfo(viewer,cid)).is_owner,false);
 const external=await sharingInfo(third,cid);assert.equal('owner' in external,false);assert.equal('members' in external,false);assert.equal((await getConversation(owner,cid,null)).conversation.title,'Compartilhamento de teste');
 await query('INSERT INTO computer_conversa_convites(conversa_id,email) VALUES($1,$2)',[cid,emails[2].toLowerCase()]);assert.equal((await getConversation(third,cid,null)).conversation.is_owner,false);const invite=(await sharingInfo(owner,cid)).members!.find(m=>m.email===emails[2])!;await assert.rejects(removeMember(viewer,cid,invite.id),{status:404});await removeMember(owner,cid,invite.id);await assert.rejects(getConversation(third,cid,null),{status:403});
}));
test('sharing PostgreSQL: scoped attachments/artifacts, private fork survives revocation without owner file references',{skip:!configured},async()=>fixture(async(owner,viewer,third,cid)=>{
 const token='a'.repeat(32),unrelated='b'.repeat(32),image={id:token,name:'imagem.jpg',size:3,kind:'image',image:Buffer.from('jpg').toString('base64')};
 const filePath=attachmentPath(owner,token);await mkdir(path.dirname(filePath),{recursive:true});await writeFile(filePath,JSON.stringify(image));await writeFile(attachmentPath(owner,unrelated),JSON.stringify({...image,id:unrelated,name:'privado.jpg'}));
 const artifact={id:'c'.repeat(32),created_at:'2026-10-30T12:00:00Z',spec:{kind:'text',name:'Relatório',extension:'txt',content:'Conteúdo'},files:[{format:'txt',name:'Relatório.txt',size:8}]};
 await query('UPDATE computer_mensagens SET pergunta=$2,pensamento=$3 WHERE conversa_id=$1',[cid,packMessage('Veja a imagem',[token]),packResponse('Pensamento',{artifacts:[artifact]})]);
 await assert.rejects(sharedAttachment(viewer,cid,token),{status:403});await changeSharing(owner,cid,'public');assert.equal((await sharedAttachment(viewer,cid,token)).image,image.image);assert.equal((await sharedAttachment(0,cid,token)).id,token);
 await assert.rejects(sharedAttachment(viewer,cid,unrelated),{status:404});assert.equal((await getConversationArtifact(viewer,cid,artifact.id)).id,artifact.id);
 const shared=await getConversation(viewer,cid,null);assert.match(shared.turns[0].attachments[0]?.preview_url||'',new RegExp('/conversations/'+cid+'/attachments/'+token+'/preview'));
 const fork=await forkConversation(viewer,cid),forkId=fork.conversation.id;assert.match(forkId,/^\d+$/);assert.notEqual(forkId,cid);assert.equal(fork.conversation.is_owner,true);
 const copy=await getConversation(viewer,forkId,null),copiedToken=copy.turns[0].attachments[0].id;
 assert.notEqual(copiedToken,token);assert.equal((await readAttachment(viewer,copiedToken)).image,image.image);const copiedArtifact=copy.turns[0].metadata.artifacts as typeof artifact[];assert.notEqual(copiedArtifact[0].id,artifact.id);assert.equal((await getConversationArtifact(viewer,forkId,copiedArtifact[0].id)).spec.kind,'text');
 await changeSharing(owner,cid,'restricted');await assert.rejects(sharedAttachment(viewer,cid,token),{status:403});await assert.rejects(getConversationArtifact(viewer,cid,artifact.id),{status:403});await assert.rejects(getConversation(third,forkId,null),{status:403});assert.equal((await getConversation(viewer,forkId,null)).turns[0].message,'Veja a imagem');
 await query('UPDATE computer_mensagens SET resposta=$2 WHERE conversa_id=$1',[forkId,'Resposta só da cópia']);assert.equal((await getConversation(owner,cid,null)).turns[0].answer,'Resposta original');
 await removeAttachment(viewer,copiedToken);await removeAttachment(owner,token);await removeAttachment(owner,unrelated);
}));
