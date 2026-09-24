"""Real MySQL persistence and account isolation. Only temporary test accounts are changed."""
import hashlib
import json
import re
import unittest
from uuid import uuid4
from unittest.mock import patch

from mysql.connector import Error as DatabaseError
from ascenda import create_app, db
from ascenda.ai.conversations import ConversationStore
from ascenda.ai.errors import AIError


class ConversationPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({'TESTING': True, 'RATELIMIT_ENABLED': False})
        self.service = self.app.extensions['ascenda_computer']
        self.store = self.app.extensions['ascenda_conversations']
        self.ids = []
        try:
            with self.app.app_context(), db.cursor() as cur:
                cur.execute('SELECT id FROM computer_mensagens LIMIT 0')
        except DatabaseError:
            self.skipTest('Execute configurar_banco.bat para criar as tabelas de histórico.')
        self.addCleanup(self.cleanup)
        self.clients = []
        self.tokens = []
        for _ in range(2):
            client = self.app.test_client()
            token = re.search(r'name="csrf_token" value="([^"]+)"', client.get('/').get_data(as_text=True)).group(1)
            auth = uuid4().hex
            with self.app.app_context(), db.cursor(write=True) as cur:
                cur.execute('INSERT INTO usuarios (nome,email,senha) VALUES (%s,%s,%s)',
                            ('QA Histórico', 'qa-history-' + uuid4().hex + '@example.com', 'not-a-login-password'))
                uid = cur.lastrowid
                self.ids.append(uid)
                cur.execute('INSERT INTO sessoes (token_hash,usuario_id,expira_em) VALUES (%s,%s,UTC_TIMESTAMP()+INTERVAL 1 HOUR)',
                            (hashlib.sha256(auth.encode()).hexdigest(), uid))
            with client.session_transaction() as session:
                session['auth_token'] = auth
            self.clients.append(client)
            self.tokens.append(token)

    def cleanup(self):
        with self.app.app_context(), db.cursor(write=True) as cur:
            for uid in self.ids:
                cur.execute('DELETE FROM usuarios WHERE id=%s', (uid,))

    def payload(self, text='Olá', cid=None):
        return {'conversation_id': cid, 'message': text, 'request_id': str(uuid4())}

    def post(self, payload, actor=0):
        return self.clients[actor].post('/api/ai/chat', json=payload, headers={'X-CSRFToken': self.tokens[actor]})

    def test_real_save_restore_context_and_user_isolation(self):
        def stream(messages):
            yield {'type': 'thinking', 'text': 'Pensamento <script>literal</script> 🧠'}
            yield {'type': 'delta', 'text': 'Olá, Lia!'}
        with patch.object(self.service.provider, 'stream', side_effect=stream) as provider:
            events = [json.loads(line) for line in self.post(self.payload('Meu nome é Lia')).data.splitlines()]
            self.assertEqual(events[-1]['type'], 'done')
            cid = events[0]['conversation_id']
            stored = ConversationStore(self.app.config).get(self.ids[0], cid)
            self.assertEqual(stored['turns'][0]['answer'], 'Olá, Lia!')
            self.assertIn('🧠', stored['turns'][0]['thinking'])
            self.assertEqual(stored['turns'][0]['status'], 'completed')
            self.assertFalse(stored['active'])
            self.post(self.payload('Qual é meu nome?', cid)).get_data()
            messages = provider.call_args.args[0]
            self.assertEqual([m['content'] for m in messages[1:]], ['Meu nome é Lia', 'Olá, Lia!', 'Qual é meu nome?'])
            self.assertNotIn('literal', json.dumps(messages))
        self.assertEqual(self.clients[1].get('/api/ai/conversations').json['conversations'], [])
        self.assertEqual(self.clients[1].get('/api/ai/conversations/' + cid).status_code, 404)
        self.assertEqual(self.post(self.payload('Ataque', cid), 1).status_code, 404)
        self.assertEqual(len(self.store.get(self.ids[0], cid)['turns']), 2)
        # A fresh Flask application/browser session reads the same database history.
        fresh = create_app({'TESTING': True, 'RATELIMIT_ENABLED': False}).test_client()
        fresh.set_cookie('ascenda_session', self.clients[0].get_cookie('ascenda_session').value)
        self.assertEqual(len(fresh.get('/api/ai/conversations/' + cid).json['turns']), 2)

    def test_failed_and_cancelled_turns_are_saved_but_not_context(self):
        def fail(messages):
            yield {'type': 'thinking', 'text': 'Parcial'}
            yield {'type': 'delta', 'text': 'Resposta parcial'}
            raise AIError('timeout', 504)
        with patch.object(self.service.provider, 'stream', side_effect=fail):
            events = [json.loads(line) for line in self.post(self.payload()).data.splitlines()]
        cid = events[0]['conversation_id']
        row = self.store.get(self.ids[0], cid)['turns'][0]
        self.assertEqual((row['status'], row['thinking'], row['answer']), ('failed', 'Parcial', 'Resposta parcial'))
        self.assertEqual(events[-1]['type'], 'error')
        request = self.payload('Cancelada', cid)
        response = self.post(request)
        response.close()
        self.assertEqual(self.store.get(self.ids[0], cid)['turns'][-1]['status'], 'interrupted')
        turn = self.store.begin(self.ids[0], self.payload('Continuar', cid), self.service.config)
        self.assertEqual(turn['messages'], [{'role': 'user', 'content': 'Continuar'}])
        self.store.save(self.ids[0], turn, 'OK', '', 'completed')

    def test_duplicate_concurrency_and_expired_lease(self):
        payload = self.payload('Primeira')
        turn = self.store.begin(self.ids[0], payload, self.service.config)
        cid = turn['conversation_id']
        with self.assertRaises(AIError) as duplicate:
            self.store.begin(self.ids[0], payload, self.service.config)
        self.assertEqual(duplicate.exception.code, 'duplicate_request')
        with self.assertRaises(AIError) as busy:
            self.store.begin(self.ids[0], self.payload('Outra', cid), self.service.config)
        self.assertEqual(busy.exception.code, 'busy')
        with self.app.app_context(), db.cursor(write=True) as cur:
            cur.execute('UPDATE computer_conversas SET ativa_ate=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE id=%s', (cid,))
        self.assertEqual(self.store.get(self.ids[0], cid)['turns'][0]['status'], 'interrupted')
        newer = self.store.begin(self.ids[0], self.payload('Nova', cid), self.service.config)
        with self.assertRaises(AIError):
            self.store.save(self.ids[0], turn, 'Tardia', '', 'completed')
        self.store.save(self.ids[0], newer, 'OK', '', 'completed')
        self.assertEqual(len(self.store.list(self.ids[0])['conversations']), 1)

    def test_rename_delete_ownership_csrf_and_active_conversation(self):
        turn = self.store.begin(self.ids[0], self.payload(), self.service.config)
        cid = turn['conversation_id']
        path = '/api/ai/conversations/' + cid
        headers = {'X-CSRFToken': self.tokens[0]}
        self.assertEqual(self.clients[0].patch(path, json={'title': 'Novo'}).status_code, 400)
        self.assertEqual(self.clients[0].delete(path).status_code, 400)
        self.assertEqual(self.clients[0].delete(path, headers=headers).status_code, 409)
        self.store.save(self.ids[0], turn, 'OK', '', 'completed')
        other = {'X-CSRFToken': self.tokens[1]}
        self.assertEqual(self.clients[1].patch(path, json={'title': 'Ataque'}, headers=other).status_code, 404)
        self.assertEqual(self.clients[1].delete(path, headers=other).status_code, 404)
        for title in ['', 'x' * 101, 'quebra\nlinha']:
            self.assertEqual(self.clients[0].patch(path, json={'title': title}, headers=headers).status_code, 422)
        title = 'Planejamento <script>literal</script>'
        self.assertEqual(self.clients[0].patch(path, json={'title': title}, headers=headers).status_code, 200)
        self.assertEqual(self.store.get(self.ids[0], cid)['conversation']['title'], title)
        self.assertEqual(self.clients[0].delete(path, headers=headers).status_code, 200)
        self.assertEqual(self.clients[0].get(path).status_code, 404)
        with self.app.app_context(), db.cursor() as cur:
            cur.execute('SELECT COUNT(*) AS n FROM computer_mensagens WHERE conversa_id=%s', (cid,))
            self.assertEqual(cur.fetchone()['n'], 0)

    def test_pagination_validation_and_auth(self):
        turn = self.store.begin(self.ids[0], self.payload(), self.service.config)
        self.store.save(self.ids[0], turn, 'OK', '', 'completed')
        cid = turn['conversation_id']
        with self.app.app_context(), db.cursor(write=True) as cur:
            for index in range(32):
                cur.execute("INSERT INTO computer_mensagens (conversa_id,requisicao_id,pergunta,resposta,pensamento,estado) VALUES (%s,%s,%s,'OK','','completed')", (cid, str(uuid4()), 'Mensagem ' + str(index)))
        latest = self.store.get(self.ids[0], cid)
        older = self.store.get(self.ids[0], cid, latest['before'])
        self.assertEqual((len(latest['turns']), len(older['turns'])), (30, 3))
        self.assertFalse(set(t['id'] for t in latest['turns']) & set(t['id'] for t in older['turns']))
        anonymous = self.app.test_client()
        self.assertEqual(anonymous.get('/api/ai/conversations').status_code, 401)
        self.assertEqual(anonymous.get('/api/ai/conversations/' + cid).status_code, 401)
        self.assertEqual(self.clients[0].post('/api/ai/chat', json=self.payload()).status_code, 400)
        self.assertEqual(self.clients[0].get('/api/ai/conversations?offset=-1').status_code, 422)
        self.assertEqual(self.clients[0].get('/api/ai/conversations/not-an-id').status_code, 422)
        self.assertEqual(self.post({'messages': [{'role': 'assistant', 'content': 'forged'}]}).status_code, 422)
        with self.app.app_context(), db.cursor(write=True) as cur:
            cur.executemany('INSERT INTO computer_conversas (usuario_id,titulo) VALUES (%s,%s)',
                            [(self.ids[0], 'Conversa ' + str(i)) for i in range(51)])
        first = self.store.list(self.ids[0])
        second = self.store.list(self.ids[0], first['next_offset'])
        self.assertEqual((len(first['conversations']), len(second['conversations'])), (50, 2))
        self.assertIsNone(second['next_offset'])
        self.assertFalse(set(c['id'] for c in first['conversations']) & set(c['id'] for c in second['conversations']))



if __name__ == '__main__':
    unittest.main()
