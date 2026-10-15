import { ApiError } from '../http';
import { query, transaction } from '../db';
import { AIError, id, iso, packMessage, unpackMessage, packResponse, unpackResponse, type ChatPayload, type Message, type Metadata } from './types';
import { attachmentMessage, publicAttachment, readAttachment, removeAttachment } from './attachments';

type Database = { query: typeof query };
type Conversation = { id: string; usuario_id: string | number; titulo: string; criado_em: Date; atualizado_em: Date; requisicao_ativa: string | null; ativa_ate: Date | null; last_response_at?: Date | null };
type StoredTurn = { id: string; pergunta: string; resposta: string; pensamento: string; estado: string; criado_em: Date };
export type Turn = { conversation_id: string | null; turn_id: string; request_id: string; messages: Message[]; created_at: string | null; has_attachments: boolean; attachments: ReturnType<typeof publicAttachment>[]; original?: StoredTurn; response_meta: Metadata };
const active = (c: Conversation) => Boolean(c.requisicao_ativa && c.ativa_ate && new Date(c.ativa_ate).getTime() > Date.now());
const serialize = (c: Conversation) => ({ id: String(c.id), title: c.titulo, updated_at: iso(c.atualizado_em), last_response_at: iso(c.last_response_at) });
async function owned(db: Database, userId: number, cid: string, lock = false) {
  const [row] = await db.query<Conversation>('SELECT * FROM computer_conversas WHERE id=$1 AND usuario_id=$2' + (lock ? ' FOR UPDATE' : ''), [id(cid), userId]);
  if (!row) throw new AIError('conversation_missing', 404);
  return row;
}
export async function listConversations(userId: number, offset: number, search: string) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 || search.length > 100) throw new AIError('invalid_request', 422);
  search = search.trim();
  const pattern = '%' + search.replace(/[!%_]/g, character => '!' + character) + '%';
  const rows = await query<Conversation>("SELECT id,titulo,atualizado_em,(SELECT MAX(m.atualizado_em) FROM computer_mensagens m WHERE m.conversa_id=c.id AND m.estado='completed') AS last_response_at FROM computer_conversas c WHERE usuario_id=$1" + (search ? " AND titulo ILIKE $3 ESCAPE '!'" : '') + ' ORDER BY atualizado_em DESC,id DESC LIMIT 51 OFFSET $2', search ? [userId, offset, pattern] : [userId, offset]);
  return { conversations: rows.slice(0, 50).map(serialize), next_offset: rows.length > 50 ? offset + 50 : null };
}
export async function previewConversation(userId: number, cid: string) {
  await owned({ query }, userId, cid);
  const [row] = await query<StoredTurn>('SELECT pergunta,resposta,pensamento,criado_em FROM computer_mensagens WHERE conversa_id=$1 ORDER BY id LIMIT 1', [cid]);
  return row ? { message: unpackMessage(row.pergunta)[0].slice(0, 500), answer: row.resposta.slice(0, 900), created_at: iso(row.criado_em), has_search: Boolean(unpackResponse(row.pensamento)[1].research) } : { message: '', answer: '', created_at: null, has_search: false };
}
export async function getConversationExport(userId: number, cid: string, turnId?: string) {
  const conversation = await owned({ query }, userId, cid);
  if (turnId !== undefined) id(turnId);
  const rows = await query<StoredTurn>('SELECT id,pergunta,resposta,pensamento,estado,criado_em FROM computer_mensagens WHERE conversa_id=$1' + (turnId !== undefined ? ' AND id=$2' : '') + ' ORDER BY id', turnId !== undefined ? [cid, turnId] : [cid]);
  if (turnId !== undefined && !rows.length) throw new ApiError(404, 'Mensagem não encontrada.');
  return { title: conversation.titulo, turns: rows.map(row => {
    const metadata = unpackResponse(row.pensamento)[1];
    const research = metadata.research;
    const sources = research && typeof research === 'object' && !Array.isArray(research) && Array.isArray((research as Metadata).sources) ? (research as Metadata).sources as unknown[] : [];
    return { message: unpackMessage(row.pergunta)[0], answer: row.resposta, sources };
  }) };
}
export async function getConversation(userId: number, cid: string, before: string | null) {
  if (before !== null) id(before);
  const conversation = await owned({ query }, userId, cid);
  const [latest] = await query<{ last_response_at: Date | null }>("SELECT MAX(atualizado_em) AS last_response_at FROM computer_mensagens WHERE conversa_id=$1 AND estado='completed'", [cid]);
  conversation.last_response_at = latest.last_response_at;
  const rows = await query<StoredTurn>('SELECT id,pergunta,resposta,pensamento,estado,criado_em FROM computer_mensagens WHERE conversa_id=$1' + (before ? ' AND id<$2' : '') + ' ORDER BY id DESC LIMIT 31', before ? [cid, before] : [cid]);
  const running = active(conversation);
  const turns = await Promise.all(rows.slice(0, 30).reverse().map(async row => {
    const [message, tokens] = unpackMessage(row.pergunta);
    const [thinking, metadata] = unpackResponse(row.pensamento);
    const attachments = (await Promise.all(tokens.map(async token => {
      try { return publicAttachment(await readAttachment(userId, token)); }
      catch (error) { if (error instanceof AIError && error.code === 'attachment_missing') return null; throw error; }
    }))).filter(file => file !== null);
    return { id: String(row.id), message, attachments, answer: row.resposta, thinking, metadata, status: row.estado === 'running' && !running ? 'interrupted' : row.estado, created_at: iso(row.criado_em) };
  }));
  return { conversation: serialize(conversation), turns, active: running, before: rows.length > 30 ? String(rows[29].id) : null };
}
export async function beginTurn(userId: number, payload: ChatPayload): Promise<Turn> {
  if (payload.anonymous) return { conversation_id: null, turn_id: payload.request_id, request_id: payload.request_id, messages: payload.messages!, created_at: new Date().toISOString(), has_attachments: false, attachments: [], response_meta: {} };
  try {
    return await transaction(async db => {
      if ((await db.query('SELECT id FROM computer_mensagens WHERE requisicao_id=$1', [payload.request_id])).length) throw new AIError('duplicate_request', 409);
      let cid = payload.conversation_id;
      if (!cid) {
        const [created] = await db.query<{ id: string }>('INSERT INTO computer_conversas (usuario_id,titulo) VALUES ($1,$2) RETURNING id', [userId, payload.message.replace(/\s+/g, ' ').slice(0, 100)]);
        cid = String(created.id);
      }
      const conversation = await owned(db, userId, cid, true);
      if (active(conversation)) throw new AIError('busy', 409);
      await db.query("UPDATE computer_mensagens SET estado='interrupted' WHERE conversa_id=$1 AND estado='running'", [cid]);
      let text = payload.message, tokens = payload.attachments, original: StoredTurn | undefined;
      if (payload.regenerate) {
        [original] = await db.query<StoredTurn>('SELECT * FROM computer_mensagens WHERE id=$1 AND conversa_id=$2', [payload.regenerate, cid]);
        if (!original) throw new AIError('conversation_missing', 404);
        [text, tokens] = unpackMessage(original.pergunta);
      }
      const previous = await db.query<StoredTurn>("SELECT pergunta,resposta FROM computer_mensagens WHERE conversa_id=$1 AND estado='completed'" + (payload.regenerate ? ' AND id<$2' : '') + ' ORDER BY id DESC LIMIT 19', payload.regenerate ? [cid, payload.regenerate] : [cid]);
      const { message: current, files } = await attachmentMessage(userId, text, tokens);
      const messages: Message[] = [];
      let hasAttachments = Boolean(tokens.length);
      for (const row of previous.reverse()) {
        const [oldText, oldTokens] = unpackMessage(row.pergunta);
        hasAttachments ||= Boolean(oldTokens.length);
        messages.push((await attachmentMessage(userId, oldText, oldTokens)).message, { role: 'assistant', content: row.resposta });
      }
      messages.push(current);
      while (messages.length > 1 && (messages.length > 39 || messages.reduce((n, m) => n + m.content.length, 0) > 48000 || messages.reduce((n, m) => n + (m.images?.length || 0), 0) > 4)) messages.splice(0, 2);
      let row: { id: string; criado_em: Date };
      if (original) [row] = await db.query<{ id: string; criado_em: Date }>("UPDATE computer_mensagens SET requisicao_id=$1,estado='running' WHERE id=$2 AND conversa_id=$3 RETURNING id,criado_em", [payload.request_id, original.id, cid]);
      else [row] = await db.query<{ id: string; criado_em: Date }>("INSERT INTO computer_mensagens (conversa_id,requisicao_id,pergunta,resposta,pensamento,estado) VALUES ($1,$2,$3,'','','running') RETURNING id,criado_em", [cid, payload.request_id, packMessage(text, tokens)]);
      await db.query("UPDATE computer_conversas SET requisicao_ativa=$1,ativa_ate=NOW()+INTERVAL '6 minutes',atualizado_em=NOW() WHERE id=$2", [payload.request_id, cid]);
      return { conversation_id: cid, turn_id: String(row.id), request_id: payload.request_id, messages, created_at: iso(row.criado_em), has_attachments: hasAttachments, attachments: files, original, response_meta: {} };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new AIError('duplicate_request', 409);
    throw error;
  }
}
export async function saveTurn(userId: number, turn: Turn, answer: string, thinking: string, status: 'running' | 'completed' | 'interrupted' | 'failed') {
  if (!turn.conversation_id) return;
  const original = turn.original;
  if (status === 'completed') {
    const metadata: Metadata = { ...turn.response_meta, answered_at: new Date().toISOString() };
    if (original) {
      const [oldThinking, oldMetadata] = unpackResponse(original.pensamento);
      const versions = Array.isArray(oldMetadata.versions) ? oldMetadata.versions : [];
      delete oldMetadata.versions;
      oldMetadata.answered_at ??= iso(original.criado_em);
      metadata.versions = [...versions, { answer: original.resposta, thinking: oldThinking, metadata: oldMetadata }];
    }
    turn.response_meta = metadata;
  }
  let packed = packResponse(thinking, turn.response_meta);
  if (original && status !== 'completed' && status !== 'running') { answer = original.resposta; packed = original.pensamento; status = original.estado as typeof status; }
  await transaction(async db => {
    const conversation = await owned(db, userId, turn.conversation_id!, true);
    if (conversation.requisicao_ativa !== turn.request_id) throw new AIError('stale_conversation', 409);
    if (!original || status !== 'running') await db.query("UPDATE computer_mensagens SET resposta=$1,pensamento=$2,estado=$3,atualizado_em=NOW() WHERE id=$4 AND conversa_id=$5 AND requisicao_id=$6 AND estado='running'", [answer, packed, status, turn.turn_id, turn.conversation_id, turn.request_id]);
    await db.query('UPDATE computer_conversas SET atualizado_em=NOW(),' + (status === 'running' ? "ativa_ate=NOW()+INTERVAL '6 minutes'" : 'requisicao_ativa=NULL,ativa_ate=NULL') + ' WHERE id=$1', [turn.conversation_id]);
  });
}
async function cleanupAttachments(userId: number, removed: Set<string>) {
  if (!removed.size) return;
  const rows = await query<{ pergunta: string }>('SELECT m.pergunta FROM computer_mensagens m JOIN computer_conversas c ON c.id=m.conversa_id WHERE c.usuario_id=$1', [userId]);
  const used = new Set(rows.flatMap(row => unpackMessage(row.pergunta)[1]));
  await Promise.all([...removed].filter(token => !used.has(token)).map(token => removeAttachment(userId, token)));
}
export async function changeConversation(userId: number, cid: string, title: unknown, remove: boolean) {
  id(cid);
  if (!remove && (typeof title !== 'string' || !title.trim() || title.trim().length > 100 || /[\u0000-\u001f]/.test(title))) throw new AIError('invalid_title', 422);
  const name = remove ? null : String(title).trim();
  const removed = new Set<string>();
  await transaction(async db => {
    if (active(await owned(db, userId, cid, true))) throw new AIError('busy', 409);
    if (remove) {
      const rows = await db.query<{ pergunta: string }>('SELECT pergunta FROM computer_mensagens WHERE conversa_id=$1', [cid]);
      rows.flatMap(row => unpackMessage(row.pergunta)[1]).forEach(token => removed.add(token));
      await db.query('DELETE FROM computer_conversas WHERE id=$1 AND usuario_id=$2', [cid, userId]);
    } else await db.query('UPDATE computer_conversas SET titulo=$1 WHERE id=$2 AND usuario_id=$3', [name, cid, userId]);
  });
  await cleanupAttachments(userId, removed);
  return { ok: true, id: cid, title: name };
}
export async function truncateConversation(userId: number, cid: string, tid: string) {
  id(tid);
  const removed = new Set<string>();
  await transaction(async db => {
    if (active(await owned(db, userId, cid, true))) throw new AIError('busy', 409);
    const [edited] = await db.query<{ pergunta: string }>('SELECT pergunta FROM computer_mensagens WHERE id=$1 AND conversa_id=$2', [tid, cid]);
    if (!edited) throw new AIError('conversation_missing', 404);
    const retained = new Set(unpackMessage(edited.pergunta)[1]);
    const later = await db.query<{ pergunta: string }>('SELECT pergunta FROM computer_mensagens WHERE conversa_id=$1 AND id>$2', [cid, tid]);
    later.flatMap(row => unpackMessage(row.pergunta)[1]).filter(token => !retained.has(token)).forEach(token => removed.add(token));
    await db.query('DELETE FROM computer_mensagens WHERE conversa_id=$1 AND id>=$2', [cid, tid]);
    await db.query('UPDATE computer_conversas SET requisicao_ativa=NULL,ativa_ate=NULL,atualizado_em=NOW() WHERE id=$1', [cid]);
  });
  await cleanupAttachments(userId, removed);
  return { conversation_id: cid };
}
