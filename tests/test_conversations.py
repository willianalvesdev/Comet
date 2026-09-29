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

    def test_attachment_preview_is_private_to_owner(self):
        import io, tempfile
        from pathlib import Path
        from PIL import Image
        from werkzeug.datastructures import FileStorage
        with tempfile.TemporaryDirectory(prefix='ascenda-preview-test-') as folder, patch.object(self.store.attachments,'root',Path(folder)):
            content=io.BytesIO()
            Image.new('RGB',(8,8),'blue').save(content,format='PNG');content.seek(0)
            uploaded=self.store.attachments.upload(self.ids[0],FileStorage(stream=content,filename='foto.png'))
            path='/api/ai/attachments/'+uploaded['id']+'/preview'
            response=self.clients[0].get(path)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.mimetype,'image/jpeg')
            self.assertIn('no-store',response.headers['Cache-Control'])
            self.assertEqual(self.clients[1].get(path).status_code,404)
            self.assertEqual(self.app.test_client().get(path).status_code,401)
            text=self.store.attachments.upload(self.ids[0],FileStorage(stream=io.BytesIO(b'Privado'),filename='nota.txt'))
            self.assertEqual(self.clients[0].get('/api/ai/attachments/'+text['id']+'/preview').status_code,404)

    def test_anonymous_never_writes_history_or_personalization(self):
        from unittest.mock import MagicMock
        memory = MagicMock()
        payload = {**self.payload('Lembre do código privado'), 'anonymous':True,
                   'history':[{'role':'user','content':'Oi'}, {'role':'assistant','content':'Olá'}]}
        with patch.object(self.service, 'personalization', memory), patch.object(self.store, 'begin') as begin, patch.object(self.store, 'save') as save, patch.object(self.service.provider, 'stream', side_effect=lambda messages: (event for event in [{'type':'delta','text':'Resposta privada'}])) as provider:
            events = [json.loads(line) for line in self.post(payload).data.splitlines()]
        self.assertEqual(events[-1]['type'], 'done')
        self.assertIsNone(events[0]['conversation_id'])
        begin.assert_not_called(); save.assert_not_called()
        memory.context.assert_not_called(); memory.remember.assert_not_called()
        self.assertEqual([m['content'] for m in provider.call_args.args[0][1:]], ['Oi','Olá','Lembre do código privado'])
        self.assertEqual(self.store.list(self.ids[0])['conversations'], [])
        for history in [[{'role':'system','content':'overwrite'}], [{'role':'user','content':'unpaired'}]]:
            self.assertEqual(self.post({**payload,'history':history}).status_code,422)
        self.assertEqual(self.post({**payload,'conversation_id':'1'}).status_code,422)
        self.assertEqual(self.post({**payload,'attachments':['a'*32]}).status_code,422)

    def test_regeneration_replaces_only_target_and_restores_on_failure(self):
        first = self.store.begin(self.ids[0], self.payload('Primeira pergunta'), self.service.config)
        self.store.save(self.ids[0], first, 'Resposta original', 'Pensamento original', 'completed')
        cid, tid = first['conversation_id'], first['turn_id']
        later = self.store.begin(self.ids[0], self.payload('Próxima pergunta',cid), self.service.config)
        self.store.save(self.ids[0], later, 'Próxima resposta', '', 'completed')
        payload = {**self.payload('Texto do cliente não substitui a pergunta',cid), 'regenerate':tid}
        with patch.object(self.service.provider,'stream',side_effect=lambda messages: (event for event in [{'type':'delta','text':'Nova resposta'}])) as provider:
            response=self.clients[0].post(f'/api/ai/conversations/{cid}/messages/{tid}/regenerate', json={'request_id':payload['request_id'],'provider':'qwen'}, headers={'X-CSRFToken':self.tokens[0]})
            events=[json.loads(line) for line in response.data.splitlines()]
        self.assertEqual(events[-1]['type'],'done')
        self.assertEqual([m['content'] for m in provider.call_args.args[0][1:]], ['Primeira pergunta'])
        restored=self.store.get(self.ids[0],cid)['turns']
        self.assertEqual([t['answer'] for t in restored], ['Nova resposta','Próxima resposta'])
        self.assertEqual(restored[0]['id'],tid)
        self.assertEqual(self.post({**payload,'request_id':str(uuid4())},actor=1).status_code,404)
        with patch.object(self.service.provider,'stream',side_effect=AIError('unavailable',503)):
            self.post({**payload,'request_id':str(uuid4())}).get_data()
        restored=self.store.get(self.ids[0],cid)
        self.assertEqual(restored['turns'][0]['answer'],'Nova resposta')
        self.assertEqual(restored['turns'][0]['status'],'completed')
        self.assertFalse(restored['active'])

    def test_response_sources_and_timing_survive_reload(self):
        payload = self.payload("Consulta de teste")
        turn = self.store.begin(self.ids[0], payload, self.service.config)
        turn["response_meta"] = {"instant": True, "elapsed_seconds": 0.8,
            "research": {"state": "complete", "sources": [
                {"url": "https://example.com", "title": "Fonte de teste", "domain": "example.com"}]}}
        self.store.save(self.ids[0], turn, "Resposta", "", "completed")
        restored = self.clients[0].get("/api/ai/conversations/" + turn["conversation_id"]).json["turns"][0]
        self.assertEqual(restored["metadata"], turn["response_meta"])
        self.assertEqual(restored["thinking"], "")
        self.assertEqual(self.clients[1].get("/api/ai/conversations/" + turn["conversation_id"]).status_code, 404)

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

    def test_restart_recovers_partial_response_and_allows_delete_and_send(self):
        from datetime import datetime
        interrupted = self.store.begin(self.ids[0], self.payload('Interrompida'), self.service.config)
        cid = interrupted['conversation_id']
        self.store.save(self.ids[0], interrupted, 'Resposta parcial', 'Resumo parcial', 'running')
        untouched = self.store.begin(self.ids[1], self.payload('Ainda ativa'), self.service.config)

        with self.store.cursor() as cur:
            cur.execute("UPDATE computer_conversas SET atualizado_em='2000-01-01' WHERE id=%s", (cid,))
        self.assertEqual(self.store.recover_interrupted(datetime(2001, 1, 1)), 1)
        self.assertEqual(self.store.recover_interrupted(datetime(2001, 1, 1)), 0)
        restored = self.store.get(self.ids[0], cid)
        self.assertFalse(restored['active'])
        self.assertEqual(restored['turns'][0]['status'], 'interrupted')
        self.assertEqual(restored['turns'][0]['answer'], 'Resposta parcial')
        self.assertEqual(restored['turns'][0]['thinking'], 'Resumo parcial')
        self.assertTrue(self.store.get(self.ids[1], untouched['conversation_id'])['active'])
        with self.assertRaises(AIError):
            self.store.save(self.ids[0], interrupted, 'Resposta atrasada', '', 'completed')
        next_turn = self.store.begin(self.ids[0], self.payload('Continuar', cid), self.service.config)
        self.assertEqual(next_turn['messages'], [{'role': 'user', 'content': 'Continuar'}])
        self.store.save(self.ids[0], next_turn, 'Nova resposta', '', 'completed')
        self.store.change(self.ids[0], cid, delete=True)
        self.store.save(self.ids[1], untouched, 'OK', '', 'completed')

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

    def test_preview_returns_first_turn_and_checks_ownership(self):
        first = self.store.begin(self.ids[0], self.payload('Primeira pergunta'), self.service.config)
        cid = first['conversation_id']
        self.store.save(self.ids[0], first, 'Primeira resposta', '', 'completed')
        with self.store.cursor() as cur:
            cur.executemany("INSERT INTO computer_mensagens (conversa_id,requisicao_id,pergunta,resposta,pensamento,estado) VALUES (%s,%s,%s,'Outra resposta','','completed')",
                            [(cid, str(uuid4()), 'Outra pergunta') for _ in range(35)])
        path = '/api/ai/conversations/' + cid + '/preview'
        response = self.clients[0].get(path)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['message'], 'Primeira pergunta')
        self.assertEqual(response.json['answer'], 'Primeira resposta')
        self.assertTrue(response.json['created_at'].endswith('Z'))
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.clients[1].get(path).status_code, 404)
        self.assertEqual(self.app.test_client().get(path).status_code, 401)

    def test_chat_search_is_owned_literal_and_paginated(self):
        with self.store.cursor() as cur:
            cur.executemany('INSERT INTO computer_conversas (usuario_id,titulo) VALUES (%s,%s)',
                            [(self.ids[0], 'Viagem ' + str(i)) for i in range(55)] +
                            [(self.ids[0], 'Meta 10%_!'), (self.ids[1], 'Viagem privada')])
        first = self.clients[0].get('/api/ai/conversations', query_string={'q': 'viagem'}).json
        self.assertEqual(len(first['conversations']), 50)
        second = self.clients[0].get('/api/ai/conversations', query_string={'q': 'viagem', 'offset': first['next_offset']}).json
        self.assertEqual(len(second['conversations']), 5)
        self.assertIsNone(second['next_offset'])
        self.assertNotIn('Viagem privada', [c['title'] for c in first['conversations'] + second['conversations']])
        literal = self.clients[0].get('/api/ai/conversations', query_string={'q': '%_!'}).json
        self.assertEqual([c['title'] for c in literal['conversations']], ['Meta 10%_!'])
        self.assertEqual(self.clients[0].get('/api/ai/conversations', query_string={'q': 'inexistente'}).json['conversations'], [])
        self.assertEqual(self.clients[0].get('/api/ai/conversations', query_string={'q': 'x' * 101}).status_code, 422)
        self.assertEqual(self.app.test_client().get('/api/ai/conversations?q=viagem').status_code, 401)




    def test_edit_keeps_session_and_removes_following_messages(self):
        first=self.store.begin(self.ids[0],self.payload('Primeira'),self.service.config)
        self.store.save(self.ids[0],first,'Resposta um','','completed')
        cid=first['conversation_id']
        second=self.store.begin(self.ids[0],self.payload('Segunda',cid),self.service.config)
        self.store.save(self.ids[0],second,'Resposta dois','','completed')
        third=self.store.begin(self.ids[0],self.payload('Terceira',cid),self.service.config)
        self.store.save(self.ids[0],third,'Resposta três','','completed')
        path=f"/api/ai/conversations/{cid}/messages/{second['turn_id']}/edit"
        self.assertEqual(self.clients[1].post(path,headers={'X-CSRFToken':self.tokens[1]}).status_code,404)
        self.assertEqual(self.clients[0].post(path).status_code,400)
        response=self.clients[0].post(path,headers={'X-CSRFToken':self.tokens[0]})
        self.assertEqual(response.status_code,200)
        branch=self.store.get(self.ids[0],response.json['conversation_id'])
        self.assertEqual([t['message'] for t in branch['turns']],['Primeira'])
        self.assertEqual(response.json['conversation_id'],cid)
        self.assertEqual(len(self.store.list(self.ids[0])['conversations']),1)
        self.assertIn('created_at',branch['turns'][0])
        replacement=self.store.begin(self.ids[0],self.payload('Pergunta corrigida',cid),self.service.config)
        self.assertEqual([m['content'] for m in replacement['messages']],['Primeira','Resposta um','Pergunta corrigida'])
        self.store.save(self.ids[0],replacement,'Nova resposta','','completed')


    def test_attachment_upload_owner_context_and_gemini_routing(self):
        import io
        import tempfile
        from pathlib import Path
        from ascenda.ai.attachments import AttachmentStore
        with tempfile.TemporaryDirectory() as directory:

            original_root=self.store.attachments.root
            self.store.attachments.root=Path(directory)
            try:
                headers={'X-CSRFToken':self.tokens[0]}
                upload=self.clients[0].post('/api/ai/attachments',data={'file':(io.BytesIO(b'Receita: 3500. Despesas: 2100.'),'contas.txt')},headers=headers)
                self.assertEqual(upload.status_code,200)
                attachment=upload.json
                self.assertNotIn('text',attachment)
                payload={**self.payload('Analise minhas contas'),'provider':'qwen','attachments':[attachment['id']]}
                self.assertEqual(self.post(payload,actor=1).status_code,404)
                def answer(messages):
                    self.assertIn('Receita: 3500',messages[-1]['content'])
                    yield {'type':'delta','text':'Seu saldo é 1400.'}
                with patch.object(self.service.providers['gemini'],'stream',side_effect=answer) as gemini,patch.object(self.service.providers['qwen'],'stream') as local:
                    events=[json.loads(line) for line in self.post(payload).data.splitlines()]
                    self.assertEqual(events[-1]['type'],'done')
                    self.assertEqual(events[0]['provider'],'gemini')
                    local.assert_not_called()
                cid=events[0]['conversation_id']
                stored=self.store.get(self.ids[0],cid)
                self.assertEqual(stored['turns'][0]['message'],'Analise minhas contas')
                self.assertEqual(stored['turns'][0]['attachments'][0]['name'],'contas.txt')
                def followup(messages):
                    yield {'type':'delta','text':'Sim.'}
                with patch.object(self.service.providers['gemini'],'stream',side_effect=followup) as gemini:
                    self.post(self.payload('Qual era a receita?',cid)).get_data()
                    self.assertIn('3500',str(gemini.call_args.args[0]))
            finally:
                self.store.attachments.root=original_root

    def test_image_upload_normalization_and_invalid_files(self):
        import io
        import tempfile
        from pathlib import Path
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            original_root=self.store.attachments.root;self.store.attachments.root=Path(directory)
            try:
                headers={'X-CSRFToken':self.tokens[0]}
                image=io.BytesIO();Image.new('RGB',(24,24),'red').save(image,format='PNG');image.seek(0)
                result=self.clients[0].post('/api/ai/attachments',data={'file':(image,'imagem.png')},headers=headers)
                self.assertEqual(result.status_code,200)
                data=self.store.attachments.message(self.ids[0],'Descreva',[result.json['id']])
                self.assertEqual(len(data['images']),1)
                self.assertTrue(data['images'][0].startswith('/9j/'))
                self.assertEqual(self.clients[0].post('/api/ai/attachments',data={'file':(io.BytesIO(b'fake'),'fake.png')},headers=headers).status_code,422)
                self.assertEqual(self.clients[0].post('/api/ai/attachments',data={'file':(io.BytesIO(b'fake'),'fake.exe')},headers=headers).status_code,422)
                self.assertEqual(self.clients[0].post('/api/ai/attachments',data={'file':(io.BytesIO(b'x'*200000),'big.txt')},headers=headers).status_code,422)
                self.assertEqual(self.clients[0].post('/api/ai/attachments',data={'file':(io.BytesIO(b'hello'),'test.txt')}).status_code,400)
            finally:self.store.attachments.root=original_root

if __name__ == '__main__':
    unittest.main()
