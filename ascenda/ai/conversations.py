"""Owned Computer conversations. Each operation commits and closes its connection."""
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import UUID
import re
from .attachments import pack, unpack

import mysql.connector
from mysql.connector import IntegrityError

from .. import db
from .errors import AIError


def conversation_id(value):
    if not isinstance(value, str) or not value.isascii() or not value.isdigit() or not 0 < int(value) < 2**64:
        raise AIError('invalid_request', 422)
    return value


class ConversationStore:
    def __init__(self, config):
        self.options = db.options(config)

    @contextmanager
    def cursor(self):
        connection = mysql.connector.connect(**self.options)
        cur = connection.cursor(dictionary=True, buffered=True)
        try:
            yield cur
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            cur.close()
            connection.close()

    @staticmethod
    def validate(payload):
        if not isinstance(payload, dict) or not {'conversation_id', 'message', 'request_id'} <= set(payload) or set(payload) - {'conversation_id', 'message', 'request_id', 'provider', 'attachments'}:
            raise AIError('invalid_request', 422)
        provider = payload.get('provider', 'qwen')
        if not isinstance(provider, str) or provider not in ('qwen', 'gemini'):
            raise AIError('invalid_request', 422)
        tokens = payload.get('attachments', [])
        if not isinstance(tokens, list) or len(tokens) > 4 or any(not isinstance(t, str) or not re.fullmatch(r'[a-f0-9]{32}', t) for t in tokens) or len(set(tokens)) != len(tokens):
            raise AIError('invalid_request', 422)
        cid, text, rid = payload['conversation_id'], payload['message'], payload['request_id']
        if cid is not None:
            conversation_id(cid)
        if not isinstance(text, str) or not text.strip() or len(text) > 8000:
            raise AIError('invalid_request', 422)
        try:
            if not isinstance(rid, str) or str(UUID(rid)) != rid:
                raise ValueError
        except (ValueError, AttributeError):
            raise AIError('invalid_request', 422) from None
        result = {'conversation_id': cid, 'message': text.strip(), 'request_id': rid, 'provider': 'gemini' if tokens else provider}
        if tokens:
            result['attachments'] = tokens
        return result

    def recover_interrupted(self, before):
        """Called by the standalone server before accepting requests after a restart."""
        with self.cursor() as cur:
            cur.execute('SELECT id FROM computer_conversas WHERE requisicao_ativa IS NOT NULL '
                        'AND atualizado_em <= %s FOR UPDATE', (before,))
            ids = [row['id'] for row in cur.fetchall()]
            for cid in ids:
                cur.execute("UPDATE computer_mensagens SET estado='interrupted' "
                            "WHERE conversa_id=%s AND estado='running'", (cid,))
                cur.execute('UPDATE computer_conversas SET requisicao_ativa=NULL,ativa_ate=NULL '
                            'WHERE id=%s', (cid,))
        return len(ids)

    @staticmethod
    def owned(cur, user_id, cid, lock=False):
        cur.execute('SELECT * FROM computer_conversas WHERE id=%s AND usuario_id=%s' +
                    (' FOR UPDATE' if lock else ''), (cid, user_id))
        row = cur.fetchone()
        if row is None:
            raise AIError('conversation_missing', 404)
        return row

    @staticmethod
    def serialize_conversation(row):
        return {'id': str(row['id']), 'title': row['titulo'],
                'updated_at': row['atualizado_em'].isoformat() + 'Z'}

    def list(self, user_id, offset=0, query=''):
        if not isinstance(query, str) or len(query) > 100:
            raise AIError('invalid_request', 422)
        query = query.strip()
        pattern = '%' + query.replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%'
        with self.cursor() as cur:
            cur.execute('SELECT id,titulo,atualizado_em FROM computer_conversas '
                        'WHERE usuario_id=%s' + (" AND titulo LIKE %s ESCAPE '!'" if query else '') +
                        ' ORDER BY atualizado_em DESC,id DESC LIMIT 51 OFFSET %s',
                        (user_id, pattern, offset) if query else (user_id, offset))
            rows = cur.fetchall()
        return {'conversations': [self.serialize_conversation(row) for row in rows[:50]],
                'next_offset': offset + 50 if len(rows) > 50 else None}

    def preview(self, user_id, cid):
        conversation_id(cid)
        with self.cursor() as cur:
            self.owned(cur, user_id, cid)
            cur.execute('SELECT pergunta,resposta,criado_em FROM computer_mensagens '
                        'WHERE conversa_id=%s ORDER BY id ASC LIMIT 1', (cid,))
            row = cur.fetchone()
        if not row:
            return {'message': '', 'answer': '', 'created_at': None}
        message, _ = unpack(row['pergunta'])
        return {'message': message[:500], 'answer': row['resposta'][:900],
                'created_at': row['criado_em'].isoformat() + 'Z'}

    def get(self, user_id, cid, before=None):
        conversation_id(cid)
        if before is not None:
            conversation_id(before)
        with self.cursor() as cur:
            convo = self.owned(cur, user_id, cid)
            cur.execute('SELECT id,pergunta,resposta,pensamento,estado,criado_em FROM computer_mensagens '
                        'WHERE conversa_id=%s' + (' AND id<%s' if before else '') +
                        ' ORDER BY id DESC LIMIT 31', (cid, before) if before else (cid,))
            rows = cur.fetchall()
        active = bool(convo['requisicao_ativa'] and convo['ativa_ate'] and
                      convo['ativa_ate'] > datetime.now(timezone.utc).replace(tzinfo=None))
        turns = []
        for row in reversed(rows[:30]):
            status = row['estado']
            if status == 'running' and not active:
                status = 'interrupted'
            text, tokens = unpack(row['pergunta'])
            files = [self.attachments.public(self.attachments.read(user_id, token)) for token in tokens]
            turns.append({'id': str(row['id']), 'message': text, 'attachments': files, 'answer': row['resposta'],
                          'thinking': row['pensamento'], 'status': status, 'created_at': row['criado_em'].isoformat() + 'Z'})
        return {'conversation': self.serialize_conversation(convo), 'turns': turns, 'active': active,
                'before': str(rows[29]['id']) if len(rows) > 30 else None}

    def begin(self, user_id, payload, config):
        provider = payload.get('provider', 'qwen')
        if not isinstance(provider, str) or provider not in ('qwen', 'gemini'):
            raise AIError('invalid_request', 422)
        cid, text, rid = payload['conversation_id'], payload['message'], payload['request_id']
        try:
            with self.cursor() as cur:
                # Request ids also prevent accidental replay after a connection loss.
                cur.execute('SELECT id FROM computer_mensagens WHERE requisicao_id=%s', (rid,))
                if cur.fetchone():
                    raise AIError('duplicate_request', 409)
                if cid is None:
                    title = ' '.join(text.split())[:100]
                    cur.execute('INSERT INTO computer_conversas (usuario_id,titulo) VALUES (%s,%s)', (user_id, title))
                    cid = str(cur.lastrowid)
                convo = self.owned(cur, user_id, cid, lock=True)
                if convo['ativa_ate'] and convo['ativa_ate'] > datetime.now(timezone.utc).replace(tzinfo=None):
                    raise AIError('busy', 409)
                cur.execute("UPDATE computer_mensagens SET estado='interrupted' WHERE conversa_id=%s AND estado='running'", (cid,))
                cur.execute("SELECT pergunta,resposta FROM computer_mensagens WHERE conversa_id=%s AND estado='completed' "
                            'ORDER BY id DESC LIMIT 19', (cid,))
                previous = list(reversed(cur.fetchall()))
                tokens = payload.get('attachments', [])
                files = [self.attachments.public(self.attachments.read(user_id, token)) for token in tokens]
                current = self.attachments.message(user_id, text, tokens) if tokens else {'role': 'user', 'content': text}
                if len(current['content']) > 38000 or sum(len(self.attachments.read(user_id, token).get('text', '')) for token in tokens) > 30000:
                    raise AIError('attachment_total', 422)
                messages = []
                has_attachments = bool(tokens)
                for row in previous:
                    previous_text, previous_tokens = unpack(row['pergunta'])
                    has_attachments = has_attachments or bool(previous_tokens)
                    message = self.attachments.message(user_id, previous_text, previous_tokens) if previous_tokens else {'role': 'user', 'content': previous_text}
                    messages.extend([message, {'role': 'assistant', 'content': row['resposta']}])
                messages.append(current)
                while len(messages) > config.max_messages or sum(len(m['content']) for m in messages) > config.max_history_chars:
                    del messages[:2]
                while sum(len(m.get('images', [])) for m in messages) > 4 and len(messages) > 1:
                    del messages[:2]
                cur.execute("INSERT INTO computer_mensagens (conversa_id,requisicao_id,pergunta,resposta,pensamento,estado) "
                            "VALUES (%s,%s,%s,'','','running')", (cid, rid, pack(text, tokens)))
                tid = str(cur.lastrowid)
                cur.execute('SELECT criado_em FROM computer_mensagens WHERE id=%s', (tid,))
                created_at = cur.fetchone()['criado_em'].isoformat() + 'Z'
                cur.execute('UPDATE computer_conversas SET requisicao_ativa=%s,ativa_ate=UTC_TIMESTAMP(6)+INTERVAL 6 MINUTE,'
                            'atualizado_em=UTC_TIMESTAMP(6) WHERE id=%s', (rid, cid))
            return {'conversation_id': cid, 'turn_id': tid, 'request_id': rid, 'messages': messages, 'created_at': created_at, 'has_attachments': has_attachments, 'attachments': files}
        except IntegrityError as exc:
            if exc.errno == 1062:
                raise AIError('duplicate_request', 409) from None
            raise

    def save(self, user_id, turn, answer, thinking, status):
        with self.cursor() as cur:
            convo = self.owned(cur, user_id, turn['conversation_id'], lock=True)
            if convo['requisicao_ativa'] != turn['request_id']:
                raise AIError('stale_conversation', 409)
            cur.execute('UPDATE computer_mensagens SET resposta=%s,pensamento=%s,estado=%s,atualizado_em=UTC_TIMESTAMP(6) '
                        "WHERE id=%s AND conversa_id=%s AND requisicao_id=%s AND estado='running'",
                        (answer, thinking, status, turn['turn_id'], turn['conversation_id'], turn['request_id']))
            cur.execute('UPDATE computer_conversas SET atualizado_em=UTC_TIMESTAMP(6)' +
                        (',requisicao_ativa=NULL,ativa_ate=NULL' if status != 'running' else '') +
                        ' WHERE id=%s', (turn['conversation_id'],))


    def change(self, user_id, cid, title=None, delete=False):
        conversation_id(cid)
        if not delete:
            if not isinstance(title, str) or not 1 <= len(title.strip()) <= 100 or any(ord(c) < 32 for c in title):
                raise AIError('invalid_title', 422)
            title = title.strip()
        removed_files = set()
        with self.cursor() as cur:
            row = self.owned(cur, user_id, cid, lock=True)
            if row['ativa_ate'] and row['ativa_ate'] > datetime.now(timezone.utc).replace(tzinfo=None):
                raise AIError('busy', 409)
            if delete:
                cur.execute('SELECT pergunta FROM computer_mensagens WHERE conversa_id=%s', (cid,))
                removed_files = {token for item in cur.fetchall() for token in unpack(item['pergunta'])[1]}
                cur.execute('DELETE FROM computer_conversas WHERE id=%s AND usuario_id=%s', (cid, user_id))
            else:
                cur.execute('UPDATE computer_conversas SET titulo=%s WHERE id=%s AND usuario_id=%s', (title, cid, user_id))
        if removed_files:
            with self.cursor() as cur:
                cur.execute('SELECT m.pergunta FROM computer_mensagens m JOIN computer_conversas c ON c.id=m.conversa_id WHERE c.usuario_id=%s', (user_id,))
                still_used = {token for item in cur.fetchall() for token in unpack(item['pergunta'])[1]}
            for token in removed_files - still_used:
                self.attachments.path(user_id, token).unlink(missing_ok=True)
        return {'ok': True, 'id': cid, 'title': title}

    def truncate_from(self, user_id, cid, tid):
        conversation_id(cid)
        conversation_id(tid)
        with self.cursor() as cur:
            original = self.owned(cur, user_id, cid, lock=True)
            if original['ativa_ate'] and original['ativa_ate'] > datetime.now(timezone.utc).replace(tzinfo=None):
                raise AIError('busy', 409)
            cur.execute('SELECT id FROM computer_mensagens WHERE id=%s AND conversa_id=%s', (tid, cid))
            if not cur.fetchone():
                raise AIError('conversation_missing', 404)
            cur.execute('DELETE FROM computer_mensagens WHERE conversa_id=%s AND id>=%s', (cid, tid))
            cur.execute('UPDATE computer_conversas SET requisicao_ativa=NULL,ativa_ate=NULL,atualizado_em=UTC_TIMESTAMP(6) WHERE id=%s', (cid,))
        return {'conversation_id': cid}
