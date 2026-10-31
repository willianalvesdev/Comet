import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import validator from 'validator';
import {query, transaction, type Database} from '../db';
import {ApiError} from '../http';
import {AIError, id, iso, unpackMessage, packMessage, unpackResponse, packResponse, type Metadata} from './types';
import {attachmentPath, readAttachment, removeAttachment} from './attachments';

export type SharedConversation = {id:string; usuario_id:string; titulo:string; criado_em:Date; atualizado_em:Date; requisicao_ativa:string|null; ativa_ate:Date|null; acesso_publico:boolean; owner_name:string; is_owner:boolean; allowed:boolean; last_response_at?:Date|null};
export async function conversationAccess(db:Database,userId:number,cid:string,ownerOnly=false) {
    const [row]=await db.query<SharedConversation>(`SELECT c.*,u.nome AS owner_name,c.usuario_id=$2 AS is_owner,
        (c.usuario_id=$2 OR c.acesso_publico OR EXISTS(SELECT 1 FROM computer_conversa_membros m WHERE m.conversa_id=c.id AND m.usuario_id=$2) OR EXISTS(SELECT 1 FROM computer_conversa_convites i JOIN usuarios v ON lower(v.email)=i.email WHERE i.conversa_id=c.id AND v.id=$2)) AS allowed
        FROM computer_conversas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.id=$1 FOR SHARE OF c`,[id(cid),userId]);
    if(!row)throw new AIError('conversation_missing',404);
    if(ownerOnly&&!row.is_owner)throw new AIError('conversation_missing',404);
    if(!ownerOnly&&!row.allowed)throw new ApiError(403,'Esta conversa é privada. Solicite acesso ao proprietário.','conversation_private');
    return row;
}
async function owner(db:Database,userId:number,cid:string) {
    const [row]=await db.query<{id:string;usuario_id:string;acesso_publico:boolean}>('SELECT id,usuario_id,acesso_publico FROM computer_conversas WHERE id=$1 AND usuario_id=$2 FOR UPDATE',[id(cid),userId]);
    if(!row)throw new AIError('conversation_missing',404);
    return row;
}
export function sharedInfo(row:SharedConversation){return {id:String(row.id),title:row.titulo,created_at:iso(row.criado_em),updated_at:iso(row.atualizado_em),last_response_at:iso(row.last_response_at),is_owner:row.is_owner,shared:!row.is_owner,owner_name:row.owner_name};}
export async function sharingInfo(userId:number,cid:string) {
    return transaction(async db=>{
        const [row]=await db.query<{usuario_id:string;acesso_publico:boolean;name:string;email:string}>('SELECT c.usuario_id,c.acesso_publico,u.nome AS name,u.email FROM computer_conversas c JOIN usuarios u ON u.id=c.usuario_id WHERE c.id=$1 FOR SHARE OF c',[id(cid)]);
        if(!row)throw new AIError('conversation_missing',404);
        const isOwner=String(userId)===String(row.usuario_id),access=row.acesso_publico?'public':'restricted';
        if(!isOwner){const [member]=await db.query('SELECT 1 FROM computer_conversa_membros WHERE conversa_id=$1 AND usuario_id=$2',[cid,userId]);const [request]=await db.query('SELECT 1 FROM computer_conversa_pedidos WHERE conversa_id=$1 AND usuario_id=$2',[cid,userId]);return {access,is_owner:false,...(member||row.acesso_publico?{owner:{id:String(row.usuario_id),name:row.name}}:{}),requested:!!request};}
        const members=await db.query<{id:string;name:string;email:string}>('SELECT u.id,u.nome AS name,u.email FROM usuarios u JOIN computer_conversa_membros m ON m.usuario_id=u.id WHERE m.conversa_id=$1 ORDER BY m.criado_em,u.id',[cid]);
        members.push(...await db.query<{id:string;name:string;email:string}>("SELECT 'invite-'||id AS id,email AS name,email FROM computer_conversa_convites WHERE conversa_id=$1 ORDER BY id",[cid]));
        const requests=await db.query<{id:string;name:string;email:string;requested_at:Date}>('SELECT u.id,u.nome AS name,u.email,p.criado_em AS requested_at FROM usuarios u JOIN computer_conversa_pedidos p ON p.usuario_id=u.id WHERE p.conversa_id=$1 ORDER BY p.criado_em,u.id',[cid]);
        return {access,is_owner:true,owner:{id:String(row.usuario_id),name:row.name,email:row.email},members,requests:requests.map(r=>({...r,requested_at:iso(r.requested_at)})),requested:false};
    });
}
export async function changeSharing(userId:number,cid:string,access:unknown){
    if(access!=='public'&&access!=='restricted')throw new ApiError(422,'Escolha uma permissão válida.');
    await transaction(async db=>{await owner(db,userId,cid);await db.query('UPDATE computer_conversas SET acesso_publico=$2 WHERE id=$1',[cid,access==='public']);});
    return sharingInfo(userId,cid);
}
export async function addMember(userId:number,cid:string,email:unknown){
    if(typeof email!=='string'||email.length>254||!validator.isEmail(email.trim()))throw new ApiError(422,'Informe um e-mail válido.');
    await transaction(async db=>{await owner(db,userId,cid);const [member]=await db.query<{id:string}>('SELECT id FROM usuarios WHERE lower(email)=lower($1)',[email.trim()]);if(!member){await db.query('INSERT INTO computer_conversa_convites(conversa_id,email) VALUES($1,$2) ON CONFLICT DO NOTHING',[cid,email.trim().toLowerCase()]);return;}
        if(String(member.id)!==String(userId))await db.query('INSERT INTO computer_conversa_membros(conversa_id,usuario_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[cid,member.id]);
        await db.query('DELETE FROM computer_conversa_pedidos WHERE conversa_id=$1 AND usuario_id=$2',[cid,member.id]);});
    return sharingInfo(userId,cid);
}
export async function removeMember(userId:number,cid:string,memberId:string){
    if(/^invite-[1-9]\d*$/.test(memberId)){await transaction(async db=>{await owner(db,userId,cid);await db.query('DELETE FROM computer_conversa_convites WHERE conversa_id=$1 AND id=$2',[id(cid),id(memberId.slice(7))]);});return sharingInfo(userId,cid);}
    await transaction(async db=>{await owner(db,userId,cid);await db.query('DELETE FROM computer_conversa_membros WHERE conversa_id=$1 AND usuario_id=$2',[cid,id(memberId)]);});return sharingInfo(userId,cid);
}
export async function requestAccess(userId:number,cid:string){
    await transaction(async db=>{const [row]=await db.query<{usuario_id:string;acesso_publico:boolean}>('SELECT usuario_id,acesso_publico FROM computer_conversas WHERE id=$1 FOR SHARE',[id(cid)]);if(!row)throw new AIError('conversation_missing',404);
        const [member]=await db.query('SELECT 1 FROM computer_conversa_membros WHERE conversa_id=$1 AND usuario_id=$2',[cid,userId]);
        if(String(row.usuario_id)!==String(userId)&&!row.acesso_publico&&!member)await db.query('INSERT INTO computer_conversa_pedidos(conversa_id,usuario_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[cid,userId]);});return {requested:true};
}
export async function decideRequest(userId:number,cid:string,memberId:string,approve:unknown){
    if(typeof approve!=='boolean')throw new ApiError(422,'Decisão inválida.');
    await transaction(async db=>{await owner(db,userId,cid);const [request]=await db.query('DELETE FROM computer_conversa_pedidos WHERE conversa_id=$1 AND usuario_id=$2 RETURNING usuario_id',[cid,id(memberId)]);if(!request)throw new ApiError(404,'Solicitação não encontrada.');
        if(approve)await db.query('INSERT INTO computer_conversa_membros(conversa_id,usuario_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[cid,memberId]);});return sharingInfo(userId,cid);
}
export async function sharedAttachment(userId:number,cid:string,token:string){
    return transaction(async db=>{const conversation=await conversationAccess(db,userId,cid);if(!/^[a-f0-9]{32}$/.test(token))throw new AIError('attachment_missing',404);
        const rows=await db.query<{pergunta:string}>('SELECT pergunta FROM computer_mensagens WHERE conversa_id=$1',[cid]);
        if(!rows.some(row=>unpackMessage(row.pergunta)[1].includes(token)))throw new AIError('attachment_missing',404);
        return readAttachment(Number(conversation.usuario_id),token);});
}
export async function forkConversation(userId:number,cid:string){
    const copied:string[]=[];
    try{return await transaction(async db=>{
        const source=await conversationAccess(db,userId,cid);
        const rows=await db.query<{pergunta:string;resposta:string;pensamento:string;criado_em:Date}>("SELECT pergunta,resposta,pensamento,criado_em FROM computer_mensagens WHERE conversa_id=$1 AND estado='completed' ORDER BY id",[cid]);
        if(!rows.length)throw new ApiError(409,'Aguarde uma resposta concluída antes de continuar esta conversa.');
        const attachments=new Map<string,string>();
        for(const token of new Set(rows.flatMap(row=>unpackMessage(row.pergunta)[1]))){const data=await readAttachment(Number(source.usuario_id),token),next=randomBytes(16).toString('hex'),target=attachmentPath(userId,next);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await writeFile(target,JSON.stringify({...data,id:next}),{encoding:'utf8',mode:0o600,flag:'wx'});copied.push(next);attachments.set(token,next);}
        const [created]=await db.query<SharedConversation>(`INSERT INTO computer_conversas(usuario_id,titulo) VALUES($1,$2) RETURNING *`,[userId,source.titulo]);
        for(const row of rows){const [message,tokens]=unpackMessage(row.pergunta);const [thinking,metadata]=unpackResponse(row.pensamento);const data=JSON.parse(JSON.stringify(metadata)) as Metadata;
            // Artifact IDs are scoped to the new conversation; never point at the owner's files.
            function reidentify(meta:Metadata){if(Array.isArray(meta.artifacts))for(const artifact of meta.artifacts)if(artifact&&typeof artifact==='object')artifact.id=randomBytes(16).toString('hex');if(Array.isArray(meta.versions))for(const version of meta.versions)if(version?.metadata)reidentify(version.metadata);}
            reidentify(data);
            await db.query("INSERT INTO computer_mensagens(conversa_id,requisicao_id,pergunta,resposta,pensamento,estado,criado_em) VALUES($1,$2,$3,$4,$5,'completed',$6)",[created.id,randomUUID(),packMessage(message,tokens.map(t=>attachments.get(t)!)),row.resposta,packResponse(thinking,data),row.criado_em]);}
        created.is_owner=true;created.owner_name='Você';return {conversation:sharedInfo(created)};
    });}catch(error){await Promise.all(copied.map(token=>removeAttachment(userId,token)));throw error;}
}
