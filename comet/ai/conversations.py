import re
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from uuid import UUID

import mysql.connector
from mysql.connector import IntegrityError

from .. import db
from .attachments import pack, unpack
from .config import PROVIDERS
from .errors import AIError
from .response_metadata import pack_response, unpack_response

def conversation_id(value):
    if not isinstance(value, str) or not value.isascii() or not value.isdigit():
        raise AIError('invalid_request', 422)
    numeric_value = value.lstrip('0')
    maximum_value = str(2**64 - 1)
    if not numeric_value or len(numeric_value) > len(maximum_value):
        raise AIError('invalid_request', 422)
    if len(numeric_value) == len(maximum_value) and numeric_value > maximum_value:
        raise AIError('invalid_request', 422)
    return value


class ConversationStore:
    def __init__(self, config):
        self.options = db.options(config)

    @contextmanager
    def cursor(self):
        with closing(mysql.connector.connect(**self.options)) as connection:
            with db.managed_cursor(connection, write=True) as database_cursor:
                yield database_cursor

    @staticmethod
    def validate(payload):
        required_fields = {'conversation_id', 'message', 'request_id'}
        allowed_fields = required_fields | {'provider', 'attachments', 'regenerate', 'web_search'}
        if not isinstance(payload, dict) or not required_fields <= payload.keys() or payload.keys() - allowed_fields:
            raise AIError('invalid_request', 422)
        if 'web_search' in payload and not isinstance(payload['web_search'], bool):
            raise AIError('invalid_request', 422)
        provider = payload.get('provider', 'qwen')
        if not isinstance(provider, str) or provider not in PROVIDERS:
            raise AIError('invalid_request', 422)
        attachment_tokens = payload.get('attachments', [])
        if not isinstance(attachment_tokens, list) or len(attachment_tokens) > 4:
            raise AIError('invalid_request', 422)
        if any(not isinstance(token, str) or not re.fullmatch(r'[a-f0-9]{32}', token) for token in attachment_tokens):
            raise AIError('invalid_request', 422)
        if len(set(attachment_tokens)) != len(attachment_tokens):
            raise AIError('invalid_request', 422)
        conversation_key = payload['conversation_id']
        message_text = payload['message']
        request_id = payload['request_id']
        if conversation_key is not None:
            conversation_id(conversation_key)
        if not isinstance(message_text, str) or not message_text.strip() or len(message_text) > 8000:
            raise AIError('invalid_request', 422)
        try:
            if not isinstance(request_id, str) or str(UUID(request_id)) != request_id:
                raise ValueError
        except (ValueError, AttributeError):
            raise AIError('invalid_request', 422) from None
        validated_payload = {
            'conversation_id': conversation_key,
            'message': message_text.strip(),
            'request_id': request_id,
            'provider': 'gemini' if attachment_tokens else provider,
        }
        if 'web_search' in payload:
            validated_payload['web_search'] = payload['web_search']
        if 'regenerate' in payload:
            if conversation_key is None:
                raise AIError('invalid_request', 422)
            validated_payload['regenerate'] = conversation_id(payload['regenerate'])
        if attachment_tokens:
            validated_payload['attachments'] = attachment_tokens
        return validated_payload

    def recover_interrupted(self, before):
        with self.cursor() as database_cursor:
            database_cursor.execute('SELECT id FROM computer_conversas WHERE requisicao_ativa IS NOT NULL '
                        'AND atualizado_em <= %s FOR UPDATE', (before,))
            interrupted_ids = [row['id'] for row in database_cursor.fetchall()]
            for conversation_key in interrupted_ids:
                database_cursor.execute("UPDATE computer_mensagens SET estado='interrupted' "
                            "WHERE conversa_id=%s AND estado='running'", (conversation_key,))
                database_cursor.execute('UPDATE computer_conversas SET requisicao_ativa=NULL,ativa_ate=NULL '
                            'WHERE id=%s', (conversation_key,))
        return len(interrupted_ids)

    @staticmethod
    def owned(database_cursor, user_id, conversation_key, lock=False):
        database_cursor.execute('SELECT * FROM computer_conversas WHERE id=%s AND usuario_id=%s' +
                    (' FOR UPDATE' if lock else ''), (conversation_key, user_id))
        row = database_cursor.fetchone()
        if row is None:
            raise AIError('conversation_missing', 404)
        return row

    @staticmethod
    def serialize_conversation(row):
        return {'id': str(row['id']), 'title': row['titulo'],
                'updated_at': row['atualizado_em'].isoformat() + 'Z'}

    def list(self, user_id, offset=0, query=''):
        if type(offset) is not int or offset < 0:
            raise AIError('invalid_request', 422)
        if not isinstance(query, str) or len(query) > 100:
            raise AIError('invalid_request', 422)
        query = query.strip()
        pattern = '%' + query.replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%'
        with self.cursor() as database_cursor:
            database_cursor.execute('SELECT id,titulo,atualizado_em FROM computer_conversas '
                        'WHERE usuario_id=%s' + (" AND titulo LIKE %s ESCAPE '!'" if query else '') +
                        ' ORDER BY atualizado_em DESC,id DESC LIMIT 51 OFFSET %s',
                        (user_id, pattern, offset) if query else (user_id, offset))
            rows = database_cursor.fetchall()
        return {'conversations': [self.serialize_conversation(row) for row in rows[:50]],
                'next_offset': offset + 50 if len(rows) > 50 else None}

    def preview(self, user_id, conversation_key):
        conversation_id(conversation_key)
        with self.cursor() as database_cursor:
            self.owned(database_cursor, user_id, conversation_key)
            database_cursor.execute('SELECT pergunta,resposta,criado_em FROM computer_mensagens '
                        'WHERE conversa_id=%s ORDER BY id ASC LIMIT 1', (conversation_key,))
            row = database_cursor.fetchone()
        if not row:
            return {'message': '', 'answer': '', 'created_at': None}
        message, _ = unpack(row['pergunta'])
        return {'message': message[:500], 'answer': row['resposta'][:900],
                'created_at': row['criado_em'].isoformat() + 'Z'}

    def get(self, user_id, conversation_key, before=None):
        conversation_id(conversation_key)
        if before is not None:
            conversation_id(before)
        with self.cursor() as database_cursor:
            conversation = self.owned(database_cursor, user_id, conversation_key)
            database_cursor.execute('SELECT id,pergunta,resposta,pensamento,estado,criado_em FROM computer_mensagens '
                        'WHERE conversa_id=%s' + (' AND id<%s' if before else '') +
                        ' ORDER BY id DESC LIMIT 31', (conversation_key, before) if before else (conversation_key,))
            rows = database_cursor.fetchall()
        active = bool(conversation['requisicao_ativa'] and conversation['ativa_ate'] and
                      conversation['ativa_ate'] > datetime.now(timezone.utc).replace(tzinfo=None))
        turns = []
        for row in reversed(rows[:30]):
            status = row['estado']
            if status == 'running' and not active:
                status = 'interrupted'
            text, tokens = unpack(row['pergunta'])
            files = [self.attachments.public(self.attachments.read(user_id, token)) for token in tokens]
            thinking, metadata = unpack_response(row['pensamento'])
            turns.append({'id': str(row['id']), 'message': text, 'attachments': files, 'answer': row['resposta'],
                          'thinking': thinking, 'metadata': metadata, 'status': status, 'created_at': row['criado_em'].isoformat() + 'Z'})
        return {'conversation': self.serialize_conversation(conversation), 'turns': turns, 'active': active,
                'before': str(rows[29]['id']) if len(rows) > 30 else None}

    def begin(self, user_id, payload, config):
        provider = payload.get('provider', 'qwen')
        if not isinstance(provider, str) or provider not in PROVIDERS:
            raise AIError('invalid_request', 422)
        conversation_key, text, request_id = payload['conversation_id'], payload['message'], payload['request_id']
        try:
            with self.cursor() as database_cursor:
                database_cursor.execute('SELECT id FROM computer_mensagens WHERE requisicao_id=%s', (request_id,))
                if database_cursor.fetchone():
                    raise AIError('duplicate_request', 409)
                if conversation_key is None:
                    title = ' '.join(text.split())[:100]
                    database_cursor.execute('INSERT INTO computer_conversas (usuario_id,titulo) VALUES (%s,%s)', (user_id, title))
                    conversation_key = str(database_cursor.lastrowid)
                conversation = self.owned(database_cursor, user_id, conversation_key, lock=True)
                if conversation['ativa_ate'] and conversation['ativa_ate'] > datetime.now(timezone.utc).replace(tzinfo=None):
                    raise AIError('busy', 409)
                database_cursor.execute("UPDATE computer_mensagens SET estado='interrupted' WHERE conversa_id=%s AND estado='running'", (conversation_key,))
                original = None
                target = payload.get('regenerate')
                if target:
                    database_cursor.execute('SELECT * FROM computer_mensagens WHERE id=%s AND conversa_id=%s', (target, conversation_key))
                    original = database_cursor.fetchone()
                    if original is None:
                        raise AIError('conversation_missing', 404)
                    text, tokens = unpack(original['pergunta'])
                else:
                    tokens = payload.get('attachments', [])
                database_cursor.execute("SELECT pergunta,resposta FROM computer_mensagens WHERE conversa_id=%s AND estado='completed' "
                            + ('AND id<%s ' if target else '') + 'ORDER BY id DESC LIMIT 19',
                            (conversation_key, target) if target else (conversation_key,))
                previous = list(reversed(database_cursor.fetchall()))
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
                if target:
                    turn_id = target
                    database_cursor.execute("UPDATE computer_mensagens SET requisicao_id=%s,estado='running' WHERE id=%s AND conversa_id=%s", (request_id, turn_id, conversation_key))
                else:
                    database_cursor.execute("INSERT INTO computer_mensagens (conversa_id,requisicao_id,pergunta,resposta,pensamento,estado) "
                                "VALUES (%s,%s,%s,'','','running')", (conversation_key, request_id, pack(text, tokens)))
                    turn_id = str(database_cursor.lastrowid)
                database_cursor.execute('SELECT criado_em FROM computer_mensagens WHERE id=%s', (turn_id,))
                created_at = database_cursor.fetchone()['criado_em'].isoformat() + 'Z'
                database_cursor.execute('UPDATE computer_conversas SET requisicao_ativa=%s,ativa_ate=UTC_TIMESTAMP(6)+INTERVAL 6 MINUTE,'
                            'atualizado_em=UTC_TIMESTAMP(6) WHERE id=%s', (request_id, conversation_key))
            return {'conversation_id': conversation_key, 'turn_id': turn_id, 'request_id': request_id, 'messages': messages, 'created_at': created_at, 'has_attachments': has_attachments, 'attachments': files, 'original': original}
        except IntegrityError as exc:
            if exc.errno == 1062:
                raise AIError('duplicate_request', 409) from None
            raise

    def save(self, user_id, turn, answer, thinking, status):
        original = turn.get('original')
        if original and status == 'running':
            return
        if status == 'completed':
            metadata = dict(turn.get('response_meta') or {})
            metadata['answered_at'] = datetime.now(timezone.utc).isoformat()
            if original:
                previous_thinking, previous_metadata = unpack_response(original['pensamento'])
                versions = previous_metadata.pop('versions', [])
                previous_metadata.setdefault('answered_at', original['criado_em'].isoformat() + 'Z')
                metadata['versions'] = [*versions, {'answer': original['resposta'],
                    'thinking': previous_thinking, 'metadata': previous_metadata}]
            turn['response_meta'] = metadata
        packed = pack_response(thinking, turn.get('response_meta'))
        if original and status != 'completed':
            answer, packed, status = original['resposta'], original['pensamento'], original['estado']
        with self.cursor() as database_cursor:
            conversation = self.owned(database_cursor, user_id, turn['conversation_id'], lock=True)
            if conversation['requisicao_ativa'] != turn['request_id']:
                raise AIError('stale_conversation', 409)
            database_cursor.execute('UPDATE computer_mensagens SET resposta=%s,pensamento=%s,estado=%s,atualizado_em=UTC_TIMESTAMP(6) '
                        "WHERE id=%s AND conversa_id=%s AND requisicao_id=%s AND estado='running'",
                        (answer, packed, status, turn['turn_id'], turn['conversation_id'], turn['request_id']))
            database_cursor.execute('UPDATE computer_conversas SET atualizado_em=UTC_TIMESTAMP(6)' +
                        (',requisicao_ativa=NULL,ativa_ate=NULL' if status != 'running' else '') +
                        ' WHERE id=%s', (turn['conversation_id'],))

    def change(self, user_id, conversation_key, title=None, delete=False):
        conversation_id(conversation_key)
        if not delete:
            if not isinstance(title, str) or not 1 <= len(title.strip()) <= 100 or any(ord(c) < 32 for c in title):
                raise AIError('invalid_title', 422)
            title = title.strip()
        removed_files = set()
        with self.cursor() as database_cursor:
            row = self.owned(database_cursor, user_id, conversation_key, lock=True)
            if row['ativa_ate'] and row['ativa_ate'] > datetime.now(timezone.utc).replace(tzinfo=None):
                raise AIError('busy', 409)
            if delete:
                database_cursor.execute('SELECT pergunta FROM computer_mensagens WHERE conversa_id=%s', (conversation_key,))
                removed_files = {token for item in database_cursor.fetchall() for token in unpack(item['pergunta'])[1]}
                database_cursor.execute('DELETE FROM computer_conversas WHERE id=%s AND usuario_id=%s', (conversation_key, user_id))
            else:
                database_cursor.execute('UPDATE computer_conversas SET titulo=%s WHERE id=%s AND usuario_id=%s', (title, conversation_key, user_id))
        if removed_files:
            with self.cursor() as database_cursor:
                database_cursor.execute('SELECT m.pergunta FROM computer_mensagens m JOIN computer_conversas c ON c.id=m.conversa_id WHERE c.usuario_id=%s', (user_id,))
                still_used = {token for item in database_cursor.fetchall() for token in unpack(item['pergunta'])[1]}
            for token in removed_files - still_used:
                self.attachments.path(user_id, token).unlink(missing_ok=True)
        return {'ok': True, 'id': conversation_key, 'title': title}

    def truncate_from(self, user_id, conversation_key, turn_id):
        conversation_id(conversation_key)
        conversation_id(turn_id)
        with self.cursor() as database_cursor:
            original = self.owned(database_cursor, user_id, conversation_key, lock=True)
            if original['ativa_ate'] and original['ativa_ate'] > datetime.now(timezone.utc).replace(tzinfo=None):
                raise AIError('busy', 409)
            database_cursor.execute('SELECT id FROM computer_mensagens WHERE id=%s AND conversa_id=%s', (turn_id, conversation_key))
            if not database_cursor.fetchone():
                raise AIError('conversation_missing', 404)
            database_cursor.execute('DELETE FROM computer_mensagens WHERE conversa_id=%s AND id>=%s', (conversation_key, turn_id))
            database_cursor.execute('UPDATE computer_conversas SET requisicao_ativa=NULL,ativa_ate=NULL,atualizado_em=UTC_TIMESTAMP(6) WHERE id=%s', (conversation_key,))
        return {'conversation_id': conversation_key}
