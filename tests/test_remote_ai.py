"""Offline provider protocol tests. No API credits or external requests are used."""
import io
import json
import unittest
from unittest.mock import patch, MagicMock
from ascenda.ai.config import AIConfig
from ascenda.ai.remote import RemoteProvider, sse
from ascenda.ai.errors import AIError
from ascenda.ai.conversations import ConversationStore

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

    def test_gemini_stream_context_and_private_header(self):
        raw = b': keepalive\n\n' + frame({'candidates': [{'content': {'parts': [{'thought': True, 'text': 'Resumo'}]}}]})
        raw += frame({'candidates': [{'content': {'parts': [{'text': 'Olá!'}]}, 'finishReason': 'STOP'}]})
        connection = self.connection(raw)
        with patch('ascenda.ai.remote.http.client.HTTPSConnection', return_value=connection) as transport:
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
        with patch('ascenda.ai.remote.http.client.HTTPSConnection', return_value=connection):
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
                with patch('ascenda.ai.remote.http.client.HTTPSConnection', return_value=connection), self.assertRaises(AIError) as error:
                    list(self.provider().stream(MESSAGES))
                self.assertEqual(error.exception.code,code)
                self.assertNotIn('private-test-key',str(error.exception))
                connection.request.assert_called_once()
                connection.close.assert_called_once()

    def test_missing_key_never_connects(self):
        with patch('ascenda.ai.remote.http.client.HTTPSConnection') as transport, self.assertRaises(AIError) as error:
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
            with self.subTest(name=name), patch('ascenda.ai.remote.http.client.HTTPSConnection', return_value=self.connection(raw)), self.assertRaises(AIError):
                list(self.provider(name).stream(MESSAGES))

    def test_cancel_closes_connection(self):
        connection = self.connection(frame({'candidates':[{'content':{'parts':[{'text':'partial'}]}}]}))
        with patch('ascenda.ai.remote.http.client.HTTPSConnection',return_value=connection):
            stream = self.provider().stream(MESSAGES)
            next(stream)
            stream.close()
        connection.close.assert_called_once()

    def test_timeout_closes_connection(self):
        connection = self.connection(b'')
        connection.getresponse.side_effect = TimeoutError
        with patch('ascenda.ai.remote.http.client.HTTPSConnection',return_value=connection), self.assertRaises(AIError) as error:
            list(self.provider().stream(MESSAGES))
        self.assertEqual(error.exception.code,'timeout')
        connection.close.assert_called_once()

    def test_allowed_providers_and_no_url_injection(self):
        from uuid import uuid4
        payload = {'conversation_id':None,'message':'Hi','request_id':str(uuid4())}
        self.assertEqual(ConversationStore.validate(payload)['provider'],'qwen')
        for name in ['qwen','gemini']:
            self.assertEqual(ConversationStore.validate({**payload,'provider':name})['provider'],name)
        for bad in ['gemma','ollama','https://attacker.invalid',None,{},1]:
            with self.assertRaises(AIError):
                ConversationStore.validate({**payload,'provider':bad})
        with self.assertRaises(ValueError):
            RemoteProvider('gemini','key','model?key=secret',CONFIG)

if __name__ == '__main__':
    unittest.main()
