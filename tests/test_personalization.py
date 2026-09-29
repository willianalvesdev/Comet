import hashlib
import json
import re
import unittest
from uuid import uuid4
from unittest.mock import patch
from ascenda import create_app, db
from ascenda.ai.personalization import learn


class PersonalizationTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({'TESTING':True,'RATELIMIT_ENABLED':False})
        self.ids=[]
        self.clients=[]
        self.tokens=[]
        self.addCleanup(self.cleanup)
        for _ in range(2):
            client=self.app.test_client()
            self.tokens.append(re.search(r'name="csrf_token" value="([^"]+)"',client.get('/').get_data(as_text=True)).group(1))
            token=uuid4().hex
            with self.app.app_context(),db.cursor(write=True) as cur:
                cur.execute('INSERT INTO usuarios (nome,email,senha) VALUES (%s,%s,%s)',('Nome do Cadastro','qa-memory-'+uuid4().hex+'@example.com','test'))
                uid=cur.lastrowid
                self.ids.append(uid)
                cur.execute('INSERT INTO sessoes (token_hash,usuario_id,expira_em) VALUES (%s,%s,UTC_TIMESTAMP()+INTERVAL 1 HOUR)',(hashlib.sha256(token.encode()).hexdigest(),uid))
            with client.session_transaction() as session:session['auth_token']=token
            self.clients.append(client)
        self.store=self.app.extensions['ascenda_personalization']
        self.service=self.app.extensions['ascenda_computer']

    def cleanup(self):
        with self.app.app_context(),db.cursor(write=True) as cur:
            for uid in self.ids:cur.execute('DELETE FROM usuarios WHERE id=%s',(uid,))

    def get(self,actor=0):return self.clients[actor].get('/api/ai/personalization')

    def save(self,**changes):
        payload={k:v for k,v in self.get().json.items() if k not in ('account_name','email')}
        payload.update(changes)
        return self.clients[0].put('/api/ai/personalization',json=payload,headers={'X-CSRFToken':self.tokens[0]})

    def chat(self,text,provider='qwen'):
        return self.clients[0].post('/api/ai/chat',json={'conversation_id':None,'message':text,'provider':provider,'request_id':str(uuid4())},headers={'X-CSRFToken':self.tokens[0]})

    def test_account_name_fields_shared_context_and_isolation(self):
        self.assertIn('Nome do Cadastro',self.store.context(self.ids[0]))
        self.assertEqual(self.save(name='Lia',occupation='Designer',about='Respostas curtas').status_code,200)
        def answer(messages):yield {'type':'delta','text':'Entendido.'}
        with patch.object(self.service.provider,'stream',side_effect=answer) as qwen:
            events=[json.loads(x) for x in self.chat('Moro em Recife. Sou estudante.').data.splitlines()]
            self.assertEqual(events[-1]['type'],'done')
            self.assertIn('Designer',qwen.call_args.args[0][0]['content'])
        profile=self.get().json
        self.assertIn('Moro em Recife',profile['summary'])
        self.assertEqual(self.get(1).json['summary'],'')
        with patch.object(self.service.providers['gemini'],'stream',side_effect=answer) as gemini:
            events=[json.loads(x) for x in self.chat('Você lembra onde moro?','gemini').data.splitlines()]
            self.assertEqual(events[-1]['type'],'done')
            self.assertIn('Moro em Recife',gemini.call_args.args[0][0]['content'])
            self.assertIn('Lia',gemini.call_args.args[0][0]['content'])
        self.assertNotIn('Recife',self.store.context(self.ids[1]))

    def test_disable_edit_clear_and_conflict(self):
        self.assertEqual(self.save(summary='Prefiro texto curto').status_code,200)
        stale={k:v for k,v in self.get().json.items() if k not in ('account_name','email')}
        self.store.remember(self.ids[0],'Sou professor')
        self.assertEqual(self.clients[0].put('/api/ai/personalization',json=stale,headers={'X-CSRFToken':self.tokens[0]}).status_code,409)
        self.assertEqual(self.save(memory_enabled=False,occupation='Arquiteto').status_code,200)
        before=self.get().json['summary']
        self.store.remember(self.ids[0],'Moro em Lisboa')
        self.assertEqual(self.get().json['summary'],before)
        context=self.store.context(self.ids[0])
        self.assertNotIn('Prefiro texto curto',context)
        self.assertIn('Arquiteto',context)
        self.assertEqual(self.save(summary='',memory_enabled=True).status_code,200)
        self.assertEqual(self.get().json['summary'],'')

    def test_auth_csrf_validation(self):
        anon=self.app.test_client()
        self.assertEqual(anon.get('/personalizar.html').status_code,302)
        self.assertEqual(anon.get('/api/ai/personalization').status_code,401)
        self.assertEqual(self.clients[0].put('/api/ai/personalization',json={}).status_code,400)
        self.assertEqual(self.save(name='x'*101).status_code,422)
        self.assertEqual(self.save(memory_enabled='false').status_code,422)
        self.assertEqual(self.save(summary='x'*6001).status_code,422)
        self.assertEqual(self.save(usuario_id=self.ids[1]).status_code,422)
        self.assertEqual(self.get().headers['Cache-Control'],'no-store')

    def test_conservative_extraction_no_answer_inference(self):
        value=learn('', 'Sou designer. Prefiro respostas curtas. Minha senha é segredo. Explique este texto: sou astronauta.')
        self.assertIn('Sou designer',value)
        self.assertNotIn('segredo',value)
        self.assertNotIn('astronauta',value)
        self.assertEqual(learn(value,'Sou designer.'),value)
        self.assertLessEqual(len(learn('x'*6000,'Sou estudante')),6000)



    def test_extended_profile_legacy_and_validation(self):
        with self.app.app_context(), db.cursor(write=True) as cur:
            self.store.get(self.ids[0])
            cur.execute('UPDATE computer_personalizacao SET sobre=%s WHERE usuario_id=%s', ('Meu texto antigo', self.ids[0]))
        self.assertEqual(self.get().json['about'], 'Meu texto antigo')
        response = self.save(company='Estúdio Aurora',birth_date='1994-05-20',gender='Feminino',response_length='Curta',formatting='Evitar',location='Latitude -23.55, longitude -46.63')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['about'], 'Meu texto antigo')
        self.assertIn('Estúdio Aurora', self.store.context(self.ids[0]))
        self.assertNotIn('Estúdio Aurora', self.store.context(self.ids[1]))

        old = {key: response.json[key] for key in ['name','occupation','about','summary','memory_enabled','version']}
        self.assertEqual(self.clients[0].put('/api/ai/personalization',json=old,headers={'X-CSRFToken':self.tokens[0]}).json['company'],'Estúdio Aurora')
        for values in [{'birth_date':'2999-01-01'},{'birth_date':'not a date'},{'response_length':'invalid'},{'gender':3},{'company':'x'*201}]:
            self.assertEqual(self.save(**values).status_code,422)

    def test_account_details_save_and_isolation(self):
        result = self.save(full_name='Lia Silva',username='lia.silva')
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.get().json['full_name'],'Lia Silva')
        self.assertEqual(self.get().json['username'],'lia.silva')
        self.assertEqual(self.get(1).json['full_name'],'Nome do Cadastro')
        self.assertIn('Lia Silva',self.store.context(self.ids[0]))
        self.assertEqual(self.save(full_name=' ').status_code,422)
        self.assertEqual(self.save(username='nome inválido').status_code,422)
        self.assertEqual(self.save(email='change@example.com').status_code,422)

if __name__=='__main__':unittest.main()
