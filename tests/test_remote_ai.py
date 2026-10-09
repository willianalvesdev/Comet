import io
import json
import unittest
from unittest.mock import patch, MagicMock
from comet.ai.config import AIConfig
from comet.ai.remote import RemoteProvider, sse
from comet.ai.errors import AIError
from comet.ai.conversations import ConversationStore

CONFIG = AIConfig('http://localhost:11434', 'test')
MESSAGES = [{'role': 'system', 'content': 'Computer'}, {'role': 'user', 'content': 'Olá'},
            {'role': 'assistant', 'content': 'Oi'}, {'role': 'user', 'content': 'Tudo bem?'}]


def frame(data):
    return ('event: message\r\ndata: ' + json.dumps(data, ensure_ascii=False) + '\r\n\r\n').encode()


class RemoteTests(unittest.TestCase):
    def connection(self, raw, status=200):
        response = io.BytesIO(raw)
        response.status = status
        response.getheader = lambda *args: 'text/event-stream'
        connection = MagicMock()
        connection.getresponse.return_value = response
        return connection

    def provider(self, name='gemini', key='private-test-key'):
        return RemoteProvider(name, key, 'gemini-3.8-flash', CONFIG)

    def test_fallback_defaults_and_opt_out(self):
        with patch.dict('os.environ', {'GEMINI_API_KEY':'test'}, clear=True):
            self.assertEqual(RemoteProvider.from_env('gemini', CONFIG).fallback_models,
                             ('gemini-2.5-flash', 'gemini-2.5-flash-lite'))
        with patch.dict('os.environ', {'GEMINI_FALLBACK_MODELS':''}):
            self.assertEqual(RemoteProvider.from_env('gemini', CONFIG).fallback_models, ())

    def test_quota_switch_preserves_search_context_images_and_identity(self):
        provider = RemoteProvider('gemini', 'secret', 'gemini-3.8-flash', CONFIG,
                                  ('gemini-2.5-flash', 'gemini-2.5-flash-lite'))
        messages = [MESSAGES[0], {'role':'user', 'content':'Arquivo', 'images':['image-data']}]
        connections = [self.connection(b'', 429), self.connection(b'', 429),
                       self.connection(frame({'candidates':[{'content':{'parts':[{'text':'Resposta'}]}, 'finishReason':'STOP'}]}))]
        with patch('comet.ai.remote.http.client.HTTPSConnection', side_effect=connections):
            self.assertEqual(list(provider.stream(messages, search=True)), [{'type':'delta','text':'Resposta'}])
        for connection, model in zip(connections, ('gemini-3.8-flash','gemini-2.5-flash','gemini-2.5-flash-lite')):
            args = connection.request.call_args
            self.assertIn(model + ':streamGenerateContent', args.args[1])
            payload = json.loads(args.kwargs['body'])
            self.assertEqual(payload['contents'][0]['parts'][1]['inlineData']['data'], 'image-data')
            self.assertEqual(payload['tools'], [{'google_search':{}}])
            self.assertIn('Modelo desta resposta: ' + model, payload['systemInstruction']['parts'][0]['text'])
            connection.close.assert_called_once()
        self.assertEqual(provider.model, 'gemini-3.8-flash')

    def test_fallback_exhaustion_is_bounded(self):
        provider = RemoteProvider('gemini', 'secret', 'first', CONFIG, ('second', 'second', 'first', 'third'))
        connections = [self.connection(b'', 429) for _ in range(3)]
        with patch('comet.ai.remote.http.client.HTTPSConnection', side_effect=connections) as transport, self.assertRaises(AIError) as error:
            list(provider.stream(MESSAGES))
        self.assertEqual(error.exception.code, 'provider_quota')
        self.assertEqual(transport.call_count, 3)

    def test_fallback_does_not_retry_other_errors_or_partial_output(self):
        provider = RemoteProvider('gemini', 'secret', 'first', CONFIG, ('second',))
        for status in (400, 401, 403, 402, 404, 500):
            with self.subTest(status=status), patch('comet.ai.remote.http.client.HTTPSConnection', return_value=self.connection(b'', status)) as transport, self.assertRaises(AIError):
                list(provider.stream(MESSAGES))
            self.assertEqual(transport.call_count, 1)
        def partial(*args):
            yield {'type':'delta', 'text':'Já começou'}
            raise AIError('provider_quota', 429)
        with patch.object(RemoteProvider, '_stream', side_effect=partial) as stream:
            source = provider.stream(MESSAGES)
            self.assertEqual(next(source)['text'], 'Já começou')
            with self.assertRaises(AIError):
                next(source)
            self.assertEqual(stream.call_count, 1)

    def test_structured_fallback_preserves_schema(self):
        provider = RemoteProvider('gemini', 'secret', 'first', CONFIG, ('second',))
        schema = {'type':'object', 'properties':{'ok':{'type':'boolean'}}}
        raw = json.dumps({'candidates':[{'content':{'parts':[{'text':'{"ok":true}'}]},'finishReason':'STOP'}]}).encode()
        connections = [self.connection(b'', 429), self.connection(raw)]
        with patch('comet.ai.remote.http.client.HTTPSConnection', side_effect=connections):
            self.assertEqual(provider.structured('System', {'input':'data'}, schema), {'ok':True})
        payloads = [json.loads(connection.request.call_args.kwargs['body']) for connection in connections]
        self.assertEqual(payloads[0], payloads[1])
        self.assertEqual(payloads[1]['generationConfig']['responseJsonSchema'], schema)
        self.assertIn('/second:generateContent', connections[1].request.call_args.args[1])

    def test_gemini_stream_context_and_private_header(self):
        raw = b': keepalive\n\n' + frame({'candidates': [{'content': {'parts': [{'thought': True, 'text': 'Resumo'}]}}]})
        raw += frame({'candidates': [{'content': {'parts': [{'text': 'Olá!'}]}, 'finishReason': 'STOP'}]})
        connection = self.connection(raw)
        with patch('comet.ai.remote.http.client.HTTPSConnection', return_value=connection) as transport:
            self.assertEqual(list(self.provider().stream(MESSAGES)), [{'type': 'thinking', 'text': 'Resumo'}, {'type': 'delta', 'text': 'Olá!'}])
        transport.assert_called_once_with('generativelanguage.googleapis.com', timeout=120)
        args, kwargs = connection.request.call_args
        self.assertNotIn('private-test-key', args[1])
        self.assertEqual(kwargs['headers']['x-goog-api-key'], 'private-test-key')
        payload = json.loads(kwargs['body'])
        self.assertEqual([m['role'] for m in payload['contents']], ['user','model','user'])
        self.assertTrue(payload['generationConfig']['thinkingConfig']['includeThoughts'])
        self.assertNotIn('private-test-key', str(payload))
        connection.close.assert_called_once()

    def test_images_and_documents_reach_gemini_with_history(self):
        import base64
        import copy
        import io
        from PIL import Image
        image = io.BytesIO()
        Image.new('RGB', (16, 16), 'red').save(image, format='JPEG')
        encoded = base64.b64encode(image.getvalue()).decode('ascii')
        messages = [MESSAGES[0], {'role': 'user', 'content': 'Analise a imagem', 'images': [encoded]},
                    {'role': 'assistant', 'content': 'Vermelho'},
                    {'role': 'user', 'content': '<arquivo nome="contas.txt">Receita: 3500</arquivo>'}]
        original = copy.deepcopy(messages)
        connection = self.connection(frame({'candidates': [{'content': {'parts': [{'text': 'Analisado'}]}, 'finishReason': 'STOP'}]}))
        with patch('comet.ai.remote.http.client.HTTPSConnection', return_value=connection):
            self.assertEqual(list(self.provider().stream(messages)), [{'type': 'delta', 'text': 'Analisado'}])
        payload = json.loads(connection.request.call_args.kwargs['body'])
        self.assertEqual(payload['contents'][0]['parts'][1],
                         {'inlineData': {'mimeType': 'image/jpeg', 'data': encoded}})
        self.assertEqual(payload['contents'][2]['parts'], [{'text': messages[3]['content']}])
        self.assertEqual([item['role'] for item in payload['contents']], ['user', 'model', 'user'])
        self.assertEqual(messages, original)
        self.assertNotIn('private-test-key', str(payload))

    def test_safe_http_errors_and_no_retries(self):
        for status, code in [(401,'provider_auth'),(403,'provider_auth'),(402,'provider_quota'),(429,'provider_quota'),(404,'provider_model'),(500,'provider_unavailable'),(302,'provider_unavailable')]:
            with self.subTest(status=status):
                connection = self.connection(b'private-test-key',status)
                with patch('comet.ai.remote.http.client.HTTPSConnection', return_value=connection), self.assertRaises(AIError) as error:
                    list(self.provider().stream(MESSAGES))
                self.assertEqual(error.exception.code,code)
                self.assertNotIn('private-test-key',str(error.exception))
                connection.request.assert_called_once()
                connection.close.assert_called_once()

    def test_missing_key_never_connects(self):
        with patch('comet.ai.remote.http.client.HTTPSConnection') as transport, self.assertRaises(AIError) as error:
            list(self.provider(key='').stream(MESSAGES))
        self.assertEqual(error.exception.code,'provider_missing')
        transport.assert_not_called()

    def test_incomplete_malformed_and_safety_never_complete(self):
        cases = [('gemini', b'data: broken\n\n'), ('gemini', b'data: {}'),
                 ('gemini', frame({'candidates':[{'content':{'parts':[{'text':'partial'}]}}]})),
                 ('gemini', frame({'candidates':[{'finishReason':'MAX_TOKENS'}]})),
                 ('gemini', frame({'promptFeedback':{'blockReason':'SAFETY'}})),
                 ('gemini', frame({'candidates': [{'content': {'parts': [{'text': 1}]}}]})),
                 ('gemini',frame({'candidates':[{'content':{'parts':[{'text':'x'*16001}]}}]}))]
        for name, raw in cases:
            with self.subTest(name=name), patch('comet.ai.remote.http.client.HTTPSConnection', return_value=self.connection(raw)), self.assertRaises(AIError):
                list(self.provider(name).stream(MESSAGES))

    def test_cancel_closes_connection(self):
        connection = self.connection(frame({'candidates':[{'content':{'parts':[{'text':'partial'}]}}]}))
        with patch('comet.ai.remote.http.client.HTTPSConnection',return_value=connection):
            stream = self.provider().stream(MESSAGES)
            next(stream)
            stream.close()
        connection.close.assert_called_once()

    def test_timeout_closes_connection(self):
        connection = self.connection(b'')
        connection.getresponse.side_effect = TimeoutError
        with patch('comet.ai.remote.http.client.HTTPSConnection',return_value=connection), self.assertRaises(AIError) as error:
            list(self.provider().stream(MESSAGES))
        self.assertEqual(error.exception.code,'timeout')
        connection.close.assert_called_once()

    def test_allowed_providers_and_no_url_injection(self):
        from uuid import uuid4
        payload = {'conversation_id':None,'message':'Hi','request_id':str(uuid4())}
        self.assertEqual(ConversationStore.validate(payload)['provider'],'qwen')
        for name in ['qwen','gemini','gemma','ollama','qwen3:4b']:
            self.assertEqual(ConversationStore.validate({**payload,'provider':name})['provider'],name)
        for bad in ['https://attacker.invalid','http://localhost:11434','qwen:cloud','',None,{},1]:
            with self.assertRaises(AIError):
                ConversationStore.validate({**payload,'provider':bad})
        with self.assertRaises(ValueError):
            RemoteProvider('gemini','key','model?key=secret',CONFIG)

if __name__ == '__main__':
    unittest.main()
