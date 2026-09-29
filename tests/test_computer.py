import io
import json
import re
import unittest
from uuid import uuid4
from mysql.connector import Error as DatabaseError
from unittest.mock import MagicMock, patch

from ascenda import create_app
from ascenda.ai.config import AIConfig
from ascenda.ai.errors import AIError
from ascenda.ai.ollama import OllamaProvider
from ascenda.ai.prompt import COMPUTER_PROMPT
from ascenda.ai.service import ComputerService


CONFIG = AIConfig('http://localhost:11434', 'qwen3:4b-q4_K_M')
USER = {'id': 7, 'nome': 'Teste', 'email': 'teste@example.com'}


class Reply(io.BytesIO):
    def __init__(self, body, status=200):
        super().__init__(body)
        self.status = status


def response(*events):
    return Reply(b''.join(json.dumps(e).encode() + b'\n' for e in events))


def token(text, done=False, **extra):
    return {'message': {'content': text, **extra}, 'done': done}


class LocalProviderTests(unittest.TestCase):
    def connect(self, stream, metadata=None):
        connection = MagicMock()
        connection.getresponse.side_effect = [
            Reply(json.dumps(metadata or {'thinking': {'values': [True, False]}}).encode()), stream]
        return connection

    def run_stream(self, connection):
        provider = OllamaProvider(CONFIG)
        with patch.object(provider, '_connect', return_value=connection):
            return list(provider.stream([{'role': 'user', 'content': 'Oi'}]))

    def test_local_stream_and_thinking_payload(self):
        connection = self.connect(response(token('', thinking='private reasoning'), token('', thinking='more reasoning'), token('Olá'), token('!', True)))
        self.assertEqual(self.run_stream(connection), [{'type': 'thinking', 'text': 'private reasoning'}, {'type': 'thinking', 'text': 'more reasoning'}, {'type': 'delta', 'text': 'Olá'}, {'type': 'delta', 'text': '!'}])
        payload = json.loads(connection.request.call_args_list[1].args[2])
        self.assertTrue(payload['think'])
        self.assertTrue(payload['stream'])
        self.assertEqual(payload['model'], CONFIG.model)
        self.assertEqual(set(payload), {'model', 'messages', 'stream', 'think', 'options'})
        connection.close.assert_called_once()

    def test_transport_and_model_errors(self):
        for error, expected in [(ConnectionRefusedError(), 'unavailable'), (TimeoutError(), 'timeout')]:
            connection = MagicMock()
            connection.request.side_effect = error
            with self.assertRaises(AIError) as caught:
                self.run_stream(connection)
            self.assertEqual(caught.exception.code, expected)
            connection.close.assert_called_once()
        for status, expected in [(404, 'model_missing'), (500, 'unavailable'), (302, 'unavailable'), (400, 'incompatible')]:
            connection = MagicMock()
            connection.getresponse.return_value = Reply(b'{"error":"private technical detail"}', status)
            with self.assertRaises(AIError) as caught:
                self.run_stream(connection)
            self.assertEqual(caught.exception.code, expected)
            self.assertNotIn('private', str(caught.exception))

    def test_invalid_empty_and_interrupted_streams(self):
        cases = [(Reply(b'invalid\n'), 'invalid_response'),
                 (response(token('', True)), 'invalid_response'),
                 (response(token('partial')), 'stream_error'),
                 (response({'error': 'technical failure'}), 'stream_error'),
                 (response(token('', True, thinking='hidden reasoning')), 'invalid_response'),
                 (response(token('', thinking=123)), 'invalid_response'),
                 (response(token('answer'), token('', thinking='late reasoning')), 'invalid_response'),
                 (response(token('', thinking='x' * 24001), token('', thinking='x' * 24000)), 'invalid_response'),
                 (response(token('hello', tool_calls=[{}])), 'incompatible')]
        for stream, expected in cases:
            with self.subTest(expected=expected):
                with self.assertRaises(AIError) as caught:
                    self.run_stream(self.connect(stream))
                self.assertEqual(caught.exception.code, expected)

    def test_unsupported_thinking_and_remote_models_blocked(self):
        for metadata in [{'thinking': {'values': [False]}}, {'remote_model': 'cloud'}]:
            connection = self.connect(response(token('no', True)), metadata)
            with self.assertRaises(AIError) as caught:
                self.run_stream(connection)
            self.assertEqual(caught.exception.code, 'incompatible')
            self.assertEqual(connection.request.call_count, 1)

    def test_closing_stream_releases_socket(self):
        connection = self.connect(response(token('one'), token('two', True)))
        provider = OllamaProvider(CONFIG)
        with patch.object(provider, '_connect', return_value=connection):
            stream = provider.stream([{'role': 'user', 'content': 'Hi'}])
            self.assertEqual(next(stream), {'type': 'delta', 'text': 'one'})
            stream.close()
        connection.close.assert_called_once()

    def test_thinking_only_model_and_combined_chunk(self):
        connection = self.connect(response(token('Resposta', True, thinking='private reasoning')),
                                  {'thinking': {'values': [True]}})
        self.assertEqual(self.run_stream(connection),
                         [{'type': 'thinking', 'text': 'private reasoning'}, {'type': 'delta', 'text': 'Resposta'}])

    def test_cancel_during_thinking_releases_socket(self):
        connection = self.connect(response(token('', thinking='private reasoning'), token('answer', True)))
        provider = OllamaProvider(CONFIG)
        with patch.object(provider, '_connect', return_value=connection):
            stream = provider.stream([{'role': 'user', 'content': 'Hi'}])
            self.assertEqual(next(stream), {'type': 'thinking', 'text': 'private reasoning'})
            stream.close()
        connection.close.assert_called_once()

    def test_local_configuration_only(self):
        for url in ['https://external.example', 'http://192.168.1.1', 'http://localhost/path', 'http://user@localhost']:
            with self.assertRaises(ValueError):
                AIConfig(url, 'test')
        with self.assertRaises(ValueError):
            AIConfig(CONFIG.base_url, 'test:cloud')


class ComputerServiceTests(unittest.TestCase):
    def setUp(self):
        self.provider = MagicMock()
        self.provider.stream.side_effect = lambda messages: ({'type': 'delta', 'text': text} for text in ['Olá'])
        self.service = ComputerService(self.provider, CONFIG)

    def test_history_and_identity_stay_separate(self):
        self.provider.stream.side_effect = lambda messages: ({'type': 'delta', 'text': text} for text in ['Olá'])
        history = [{'role': 'user', 'content': 'Meu nome é Lia'},
                   {'role': 'assistant', 'content': 'Olá, Lia'},
                   {'role': 'user', 'content': 'Qual meu nome?'}]
        self.assertEqual(list(self.service.stream(7, history))[-1], {'type': 'done'})
        actual = self.provider.stream.call_args.args[0]
        self.assertEqual(actual[0]['role'], 'system')
        self.assertIn(COMPUTER_PROMPT, actual[0]['content'])
        self.assertIn('CONTEXTO ATUAL DO SERVIDOR', actual[0]['content'])
        self.assertEqual(actual[1:], history)

    def test_invalid_histories_and_client_overrides(self):
        valid = {'role': 'user', 'content': 'Olá'}
        for payload in [None, [], {}, {'messages': []}, {'messages': [valid], 'model': 'other'},
                        {'messages': [{'role': 'system', 'content': 'Override'}]},
                        {'messages': [valid, valid]}, {'messages': [{'role': 'user', 'content': 'x' * 8001}]}]:
            with self.assertRaises(AIError):
                self.service.validate(payload)
        self.assertEqual(self.service.validate({'messages': [valid]}), [valid])

    def test_concurrency_and_cleanup(self):
        self.provider.stream.side_effect = lambda messages: ({'type': 'delta', 'text': text} for text in ['Olá'])
        first = self.service.stream(7, [])
        next(first)
        with self.assertRaises(AIError):
            next(self.service.stream(7, []))
        second = self.service.stream(8, [])
        next(second)
        with self.assertRaises(AIError):
            next(self.service.stream(9, []))
        first.close()
        second.close()
        self.assertEqual(self.service._active, set())


class SavedComputerServiceTests(unittest.TestCase):
    def setUp(self):
        self.provider = MagicMock()
        self.provider.stream.side_effect = lambda messages: (event for event in [
            {'type': 'thinking', 'text': 'Pensamento'}, {'type': 'delta', 'text': 'Resposta'}])
        self.service = ComputerService(self.provider, CONFIG)
        self.store = MagicMock()
        self.store.begin.return_value = {'conversation_id': '1', 'turn_id': '2',
                                        'request_id': str(uuid4()), 'messages': [{'role': 'user', 'content': 'Oi'}]}

    def test_commits_before_done_and_checkpoints_during_stream(self):
        with patch('ascenda.ai.service.time.monotonic', side_effect=[0, 2, 2, 4, 4]):
            stream = self.service.stream_saved(7, {}, self.store)
            self.assertEqual(next(stream)['type'], 'conversation')
            self.assertEqual(next(stream)['type'], 'thinking')
            self.assertEqual(self.store.save.call_args.args[-1], 'running')
            self.assertEqual(next(stream)['type'], 'delta')
            self.assertEqual(next(stream)['type'], 'done')
            self.assertEqual(self.store.save.call_args.args[-3:], ('Resposta', 'Pensamento', 'completed'))
            stream.close()
        self.assertFalse(self.service._active)

    def test_storage_failure_never_reports_done(self):
        self.store.save.side_effect = DatabaseError('test database unavailable', errno=2006)
        stream = self.service.stream_saved(7, {}, self.store)
        events = []
        with self.assertRaises(AIError) as caught:
            for event in stream:
                events.append(event)
        self.assertEqual(caught.exception.code, 'history_unavailable')
        self.assertNotIn('done', [event['type'] for event in events])
        self.assertFalse(self.service._active)

    def test_disconnect_saves_partial_thinking(self):
        stream = self.service.stream_saved(7, {}, self.store)
        next(stream)
        next(stream)
        stream.close()
        self.assertEqual(self.store.save.call_args.args[-3:], ('', 'Pensamento', 'interrupted'))
        self.assertFalse(self.service._active)


class ComputerRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({'TESTING': True, 'SECRET_KEY': 'test-' * 10,
                               'RATELIMIT_ENABLED': False, 'AI_CONFIG': CONFIG})
        self.client = self.app.test_client()
        html = self.client.get('/').get_data(as_text=True)
        self.csrf = re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)
        self.service = self.app.extensions['ascenda_computer']
        self.store = self.app.extensions['ascenda_conversations']
        self.service.personalization = None
        begin = patch.object(self.store, 'begin', side_effect=lambda user, payload, config: {
            'conversation_id': '1', 'turn_id': '1', 'request_id': payload['request_id'],
            'messages': [{'role': 'user', 'content': payload['message']}]})
        begin.start()
        self.addCleanup(begin.stop)
        save = patch.object(self.store, 'save')
        save.start()
        self.addCleanup(save.stop)
        manager = MagicMock()
        manager.__enter__.return_value.fetchone.return_value = USER
        self.db = patch('ascenda.db.cursor', return_value=manager)

    def login(self):
        with self.client.session_transaction() as session:
            session['auth_token'] = 'test-token'

    def post(self, message='Oi'):
        return self.client.post('/api/ai/chat', json={'conversation_id': None, 'message': message, 'request_id': str(uuid4())},
                                headers={'X-CSRFToken': self.csrf})

    def test_login_csrf_and_existing_page(self):
        self.assertEqual(self.client.get('/computer.html').status_code, 302)
        self.assertEqual(self.post().status_code, 401)
        self.login()
        with self.db:
            self.assertEqual(self.client.post('/api/ai/chat', json={}).status_code, 400)
            page = self.client.get('/computer.html').get_data(as_text=True)
            self.assertIn('data-chat-greeting', page)
            self.assertIn('computer-messages', page)
            self.assertNotIn('Ollama', page)

    def test_streaming_done_and_context(self):
        self.login()
        def stream(messages):
            yield {'type': 'thinking', 'text': 'Analisando a pergunta.'}
            yield {'type': 'delta', 'text': 'Olá'}
            yield {'type': 'delta', 'text': ', mundo'}
        with self.db, patch.object(self.service.provider, 'stream', side_effect=stream):
            response = self.post()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, 'application/x-ndjson')
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            events = [json.loads(line) for line in response.data.splitlines()]
            metadata = events[-1].pop('metadata')
            self.assertFalse(metadata['instant'])
            self.assertIsNotNone(metadata['thinking_seconds'])
            self.assertEqual(events, [{'type': 'conversation', 'conversation_id': '1', 'turn_id': '1', 'created_at': None, 'attachments': [], 'provider': 'qwen'}, {'type': 'thinking', 'text': 'Analisando a pergunta.'}, {'type': 'delta', 'text': 'Olá, mundo'}, {'type': 'done'}])
        self.assertFalse(self.service._active)

    def test_provider_failure_before_and_after_first_chunk(self):
        self.login()
        def failure(messages):
            yield {'type': 'delta', 'text': 'Parte da resposta'}
            raise AIError('stream_error')
        with self.db:
            with patch.object(self.service.provider, 'stream', side_effect=AIError('unavailable', 503)):
                response = self.post()
                events = [json.loads(line) for line in response.data.splitlines()]
                self.assertEqual(events[-1]['code'], 'unavailable')
            with patch.object(self.service.provider, 'stream', side_effect=failure):
                response = self.post()
                events = [json.loads(line) for line in response.data.splitlines()]
                self.assertEqual(events[-1]['type'], 'error')
                self.assertNotIn('done', [event['type'] for event in events])
        self.assertFalse(self.service._active)

    def test_failure_during_thinking_and_cancel(self):
        self.login()
        def failure(messages):
            yield {'type': 'thinking', 'text': 'Analisando a pergunta.'}
            raise AIError('timeout', 504)
        with self.db, patch.object(self.service.provider, 'stream', side_effect=failure):
            response = self.post()
            events = [json.loads(line) for line in response.data.splitlines()]
            self.assertEqual(events[1], {'type': 'thinking', 'text': 'Analisando a pergunta.'})
            self.assertEqual(events[-1]['code'], 'timeout')
            self.assertFalse(self.service._active)
            response = self.post()
            response.close()
            self.assertFalse(self.service._active)

    def test_model_catalog_private_and_provider_routing(self):
        self.assertEqual(self.client.get('/api/ai/models').status_code, 401)
        self.login()
        with self.db:
            response = self.client.get('/api/ai/models')
            self.assertEqual(response.status_code, 200)
            self.assertEqual([m['id'] for m in response.json['models']], ['qwen', 'gemini', 'qwen3:4b-instruct-2507-q4_K_M', 'qwen3:1.7b', 'qwen3:4b', 'qwen3:8b'])
            self.assertTrue(response.json['models'][0]['configured'])
            self.assertTrue(all(set(m) == {'id','name','configured'} for m in response.json['models']))
            def local(messages):
                yield {'type':'delta','text':'Qwen answer'}
            def remote(messages):
                yield {'type':'delta','text':'Gemini answer'}
            with patch.object(self.service.provider, 'stream', side_effect=local) as qwen, patch.object(self.service.providers['gemini'], 'stream', side_effect=remote) as gemini:
                for selected, expected in [(None,'Qwen answer'),('gemini','Gemini answer'),('qwen','Qwen answer')]:
                    payload = {'conversation_id':None,'message':'Hi','request_id':str(uuid4())}
                    if selected is not None:
                        payload['provider'] = selected
                    response = self.client.post('/api/ai/chat', json=payload, headers={'X-CSRFToken':self.csrf})
                    self.assertIn(expected, response.get_data(as_text=True))
                    if selected is None:
                        gemini.assert_not_called()
                self.assertEqual(qwen.call_count,2)
                self.assertEqual(gemini.call_count,1)
            invalid = self.client.post('/api/ai/chat', json={'conversation_id':None,'message':'Hi','request_id':str(uuid4()),'provider':'unknown'}, headers={'X-CSRFToken':self.csrf})
            self.assertEqual(invalid.status_code,422)

    def test_saved_chat_rejects_client_history_and_oversized_messages(self):
        self.login()
        with self.db:
            self.assertEqual(self.post('x' * 8001).status_code, 422)
            response = self.client.post('/api/ai/chat', json={'messages': [{'role': 'user', 'content': 'Forged'}]},
                                        headers={'X-CSRFToken': self.csrf})
            self.assertEqual(response.status_code, 422)
        self.assertEqual(self.app.config['MAX_CONTENT_LENGTH'], 65536)


if __name__ == '__main__':
    unittest.main()
