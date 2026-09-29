import json
import unittest
from hashlib import sha256
from unittest.mock import MagicMock, patch
from uuid import uuid4

from mysql.connector import Error as DatabaseError

from ascenda import create_app
from ascenda.ai.config import AIConfig
from ascenda.ai.ephemeral import EphemeralStore


class RouteContractTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({
            'TESTING': True,
            'SECRET_KEY': 'route-contract-test-' * 4,
            'WTF_CSRF_ENABLED': False,
            'RATELIMIT_ENABLED': False,
            'AI_CONFIG': AIConfig('http://localhost:11434', 'qwen3:4b-q4_K_M'),
        })
        self.client = self.app.test_client()
        self.user = {'id': 7, 'nome': 'Teste', 'email': 'teste@example.com'}
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.cursor.fetchone.return_value = self.user
        self.connect_patch = patch('ascenda.db.mysql.connector.connect', return_value=self.connection)
        self.connect = self.connect_patch.start()
        self.addCleanup(self.connect_patch.stop)

    def sign_in(self, token='test-token'):
        with self.client.session_transaction() as session:
            session['auth_token'] = token

    def test_api_authentication_preserves_status_messages_and_codes(self):
        cases = [
            ('GET', '/api/ai/models', 'Entre novamente para escolher um modelo.', False),
            ('POST', '/api/ai/attachments', 'Entre novamente para anexar arquivos.', False),
            ('GET', '/api/ai/attachments/token/preview', 'Entre novamente para ver o anexo.', False),
            ('POST', '/api/ai/chat', 'Entre novamente para conversar com a Computer.', True),
            ('POST', '/api/ai/conversations/1/messages/2/regenerate', 'Entre novamente para conversar com a Computer.', True),
            ('GET', '/api/ai/conversations', 'Entre novamente para acessar suas conversas.', False),
            ('GET', '/api/ai/conversations/1', 'Entre novamente para acessar suas conversas.', False),
            ('GET', '/api/ai/conversations/1/preview', 'Entre novamente para acessar suas conversas.', False),
            ('PATCH', '/api/ai/conversations/1', 'Entre novamente para acessar suas conversas.', False),
            ('DELETE', '/api/ai/conversations/1', 'Entre novamente para acessar suas conversas.', False),
            ('POST', '/api/ai/conversations/1/messages/2/edit', 'Entre novamente para editar suas mensagens.', False),
            ('GET', '/api/ai/personalization', 'Entre novamente para personalizar o Computer.', False),
            ('PUT', '/api/ai/personalization', 'Entre novamente para personalizar o Computer.', False),
            ('GET', '/api/news', 'Entre novamente para ver as notícias.', True),
        ]
        for method, path, message, include_code in cases:
            with self.subTest(method=method, path=path):
                response = self.client.open(path, method=method, json={})
                expected = {'error': message}
                if include_code:
                    expected['code'] = 'unauthorized'
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json, expected)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.connect.assert_not_called()

    def test_authentication_connection_closes_before_news_service_runs(self):
        self.sign_in()
        news_service = self.app.extensions['ascenda_news']

        def read_news(*args):
            self.connection.close.assert_called_once()
            self.cursor.close.assert_called_once()
            return {'articles': []}

        with patch.object(news_service, 'get', side_effect=read_news):
            response = self.client.get('/api/news')
        self.assertEqual(response.status_code, 200)
        self.connection.close.assert_called_once()

    def test_authentication_failure_closes_connection_and_hides_database_details(self):
        self.sign_in()
        self.cursor.fetchone.side_effect = DatabaseError('internal database details', errno=2006)
        response = self.client.get('/api/ai/models')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('internal database details', response.get_data(as_text=True))
        self.connection.close.assert_called_once()
        self.cursor.close.assert_called_once()

    def test_session_lookup_uses_a_bound_token_hash(self):
        token = "' OR 1=1; --"
        self.sign_in(token)
        response = self.client.get('/api/ai/models')
        self.assertEqual(response.status_code, 200)
        query, parameters = self.cursor.execute.call_args.args
        self.assertIn('s.token_hash=%s', query)
        self.assertNotIn(token, query)
        self.assertEqual(parameters, (sha256(token.encode()).hexdigest(),))
        self.connection.close.assert_called_once()

    def test_non_string_session_can_log_out_without_database_access(self):
        self.sign_in(42)
        response = self.client.post('/logout')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, '/')
        self.connect.assert_not_called()
        with self.client.session_transaction() as session:
            self.assertNotIn('auth_token', session)

    def test_regenerate_keeps_identifiers_and_closes_abandoned_stream(self):
        self.sign_in()
        service = self.app.extensions['ascenda_computer']
        store = self.app.extensions['ascenda_conversations']
        request_id = str(uuid4())
        closed = []

        def stream(user_id, payload, selected_store):
            self.connection.close.assert_called_once()
            self.assertEqual(user_id, self.user['id'])
            self.assertIs(selected_store, store)
            self.assertEqual(payload['conversation_id'], '11')
            self.assertEqual(payload['regenerate'], '22')
            self.assertEqual(payload['request_id'], request_id)
            try:
                yield {'type': 'conversation', 'conversation_id': '11', 'turn_id': '22'}
                yield {'type': 'done'}
            finally:
                closed.append(True)

        with patch.object(service, 'stream_saved', side_effect=stream):
            response = self.client.post('/api/ai/conversations/11/messages/22/regenerate', json={
                'request_id': request_id, 'provider': 'qwen3:4b-instruct-2507-q4_K_M',
            })
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, 'application/x-ndjson')
            self.assertEqual(response.headers['X-Accel-Buffering'], 'no')
            response.close()
        self.assertEqual(closed, [True])

    def test_anonymous_chat_never_selects_persistent_store(self):
        self.sign_in()
        service = self.app.extensions['ascenda_computer']
        persistent_store = self.app.extensions['ascenda_conversations']

        def stream(user_id, payload, selected_store):
            self.assertIsInstance(selected_store, EphemeralStore)
            self.assertIsNot(selected_store, persistent_store)
            yield {'type': 'done'}

        with patch.object(service, 'stream_saved', side_effect=stream), \
                patch.object(persistent_store, 'validate') as validate:
            response = self.client.post('/api/ai/chat', json={
                'anonymous': True, 'message': 'Oi', 'history': [], 'conversation_id': None,
                'request_id': str(uuid4()), 'provider': 'qwen3:4b-instruct-2507-q4_K_M',
            })
            self.assertEqual(response.status_code, 200)
            self.assertEqual([json.loads(line) for line in response.data.splitlines()], [{'type': 'done'}])
            validate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
