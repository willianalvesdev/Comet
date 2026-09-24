"""Conversation validation, identity and bounded inference concurrency."""
from threading import Lock
from contextlib import contextmanager
import logging
import time

from mysql.connector import Error as DatabaseError

from .errors import AIError
from .prompt import COMPUTER_PROMPT


class ComputerService:
    def __init__(self, provider, config, providers=None):
        self.provider = provider
        self.providers = providers or {}
        self.config = config
        self.personalization = None
        self._lock = Lock()
        self._active = set()

    def validate(self, payload):
        if not isinstance(payload, dict) or set(payload) != {'messages'}:
            raise AIError('invalid_request', 422)
        messages = payload['messages']
        if not isinstance(messages, list) or not 1 <= len(messages) <= self.config.max_messages:
            raise AIError('invalid_request', 422)
        result = []
        for i, message in enumerate(messages):
            if (not isinstance(message, dict) or set(message) != {'role', 'content'}
                    or message['role'] != ('user' if i % 2 == 0 else 'assistant')
                    or not isinstance(message['content'], str) or not message['content'].strip()
                    or len(message['content']) > (self.config.max_message_chars if i % 2 == 0 else 16000)):
                raise AIError('invalid_request', 422)
            result.append({'role': message['role'], 'content': message['content']})
        if len(result) % 2 == 0 or sum(len(m['content']) for m in result) > self.config.max_history_chars:
            raise AIError('invalid_request', 422)
        return result

    @contextmanager
    def slot(self, user_id):
        with self._lock:
            if user_id in self._active or len(self._active) >= 2:
                raise AIError('busy', 429)
            self._active.add(user_id)
        try:
            yield
        finally:
            with self._lock:
                self._active.discard(user_id)

    def generate(self, messages, provider=None, context=""):
        source = (provider or self.provider).stream([{'role': 'system', 'content': COMPUTER_PROMPT + context}, *messages])
        try:
            yield from source
        finally:
            source.close()

    def stream(self, user_id, messages):
        with self.slot(user_id):
            yield from self.generate(messages)
            yield {'type': 'done'}

    def stream_saved(self, user_id, payload, store):
        with self.slot(user_id):
            turn = None
            source = None
            answer = thinking = ''
            status = 'interrupted'
            saved = False
            try:
                name = payload.get('provider', 'qwen')
                if self.providers and name not in self.providers:
                    raise AIError('invalid_request', 422)
                provider = self.providers.get(name, self.provider)
                context = self.personalization.context(user_id) if self.personalization else ''
                turn = store.begin(user_id, payload, self.config)
                yield {'type': 'conversation', 'conversation_id': turn['conversation_id'], 'turn_id': turn['turn_id']}
                source = self.generate(turn['messages'], provider, context)
                checkpoint = time.monotonic()
                for event in source:
                    if event['type'] == 'thinking':
                        thinking += event['text']
                    else:
                        answer += event['text']
                    if time.monotonic() - checkpoint >= 1:
                        store.save(user_id, turn, answer, thinking, 'running')
                        checkpoint = time.monotonic()
                    yield event
                if not answer.strip():
                    raise AIError('invalid_response')
                store.save(user_id, turn, answer, thinking, 'completed')
                saved = True
                if self.personalization:
                    try:
                        self.personalization.remember(user_id, payload['message'])
                    except DatabaseError:
                        logging.getLogger(__name__).warning('Could not update account memory')
                yield {'type': 'done'}
            except DatabaseError:
                status = 'failed'
                raise AIError('history_unavailable', 503) from None
            except Exception:
                status = 'failed'
                raise
            finally:
                if source is not None:
                    source.close()
                if turn is not None and not saved:
                    try:
                        store.save(user_id, turn, answer, thinking, status)
                    except (DatabaseError, AIError):
                        logging.getLogger(__name__).warning('Could not finalize saved Computer turn')
