import http.client
import json
import os
import re
import socket
import time

from .errors import AIError


def sse(response, deadline):

    data, size, total = [], 0, 0
    while True:
        if time.monotonic() > deadline:
            raise AIError('timeout', 504)
        raw = response.readline(1048577)
        if not raw:
            if data:
                raise AIError('invalid_response')
            return
        total += len(raw)
        if len(raw) > 1048576 or total > 8388608:
            raise AIError('invalid_response')
        line = raw.decode('utf-8').rstrip('\r\n')
        if not line:
            if data:
                yield '\n'.join(data)
            data, size = [], 0
        elif line.startswith('data:'):
            value = line[5:].removeprefix(' ')
            size += len(value)
            if size > 1048576:
                raise AIError('invalid_response')
            data.append(value)


def structured_json(raw):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    def invalid_constant(value):
        raise ValueError(value)
    try:
        return json.loads(raw, object_pairs_hook=unique_pairs, parse_constant=invalid_constant)
    except RecursionError:
        raise ValueError('JSON nesting exceeds the supported depth') from None


def read_structured_response(response, deadline):
    chunks, size = [], 0
    while True:
        if time.monotonic() > deadline:
            raise AIError('timeout', 504)
        raw = response.read1(8192)
        if not raw:
            break
        size += len(raw)
        if size > 131072:
            raise AIError('invalid_response')
        chunks.append(raw)
    return structured_json(b''.join(chunks))


class RemoteProvider:
    def __init__(self, name, key, model, config, fallback_models=()):
        if name not in ('gemini',) or not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', model):
            raise ValueError('Configure um identificador de modelo válido para Gemini.')
        self.name, self.key, self.model, self.config = name, key.strip(), model, config
        self.label = 'Gemini'
        self.fallback_models = tuple(dict.fromkeys(item for item in fallback_models if item != model))
        if len(self.fallback_models) > 5 or any(not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', item) for item in self.fallback_models):
            raise ValueError('Configure identificadores válidos para os modelos alternativos do Gemini.')

    @classmethod
    def from_env(cls, name, config):
        return cls(name, os.getenv('GEMINI_API_KEY', ''),
                   os.getenv('GEMINI_MODEL', 'gemini-3.8-flash'), config,
                   tuple(item.strip() for item in os.getenv('GEMINI_FALLBACK_MODELS',
                         'gemini-2.5-flash,gemini-2.5-flash-lite').split(',') if item.strip()))

    def request(self, messages, search=False):
        identity = f'\nModelo desta resposta: {self.model}. Provedor: {self.label}. Processamento via API externa.'
        system = messages[0]['content'] + identity
        headers = {'Content-Type': 'application/json', 'Accept': 'text/event-stream'}
        headers['x-goog-api-key'] = self.key
        contents = []
        for message in messages[1:]:
            parts = [{'text': message['content']}]
            if message['role'] == 'user':

                parts.extend({'inlineData': {'mimeType': 'image/jpeg', 'data': data}}
                             for data in message.get('images', []))
            contents.append({'role': 'model' if message['role'] == 'assistant' else 'user',
                             'parts': parts})
        payload = {'systemInstruction': {'parts': [{'text': system}]},
                   'contents': contents,
                   'generationConfig': {'maxOutputTokens': 8192,
                                        'thinkingConfig': {'includeThoughts': True}}}
        if search:
            payload['tools'] = [{'google_search': {}}]
        return ('generativelanguage.googleapis.com',
                f'/v1beta/models/{self.model}:streamGenerateContent?alt=sse', headers, payload)

    def attempts(self):
        yield self
        for model in self.fallback_models:
            yield RemoteProvider(self.name, self.key, model, self.config)

    def structured(self, system, data, schema):
        deadline = time.monotonic() + self.config.total_timeout
        for provider in self.attempts():
            if time.monotonic() >= deadline:
                raise AIError('timeout', 504)
            try:
                return provider._structured(system, data, schema, deadline)
            except AIError as error:
                if error.code != 'provider_quota' or error.status != 429:
                    raise
                last_error = error
        raise last_error

    def _structured(self, system, data, schema, deadline):
        if not self.key:
            raise AIError('provider_missing', 503)
        payload = {'systemInstruction': {'parts': [{'text': system}]},
                   'contents': [{'role': 'user', 'parts': [{'text': json.dumps(data, ensure_ascii=False)}]}],
                   'generationConfig': {'temperature': 0, 'maxOutputTokens': 8192,
                                        'responseMimeType': 'application/json', 'responseJsonSchema': schema}}
        connection = http.client.HTTPSConnection('generativelanguage.googleapis.com', timeout=self.config.timeout)
        try:
            connection.request('POST', f'/v1beta/models/{self.model}:generateContent',
                               body=json.dumps(payload, ensure_ascii=False).encode(),
                               headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'x-goog-api-key': self.key})
            response = connection.getresponse()
            if response.status != 200:
                code = ('provider_auth' if response.status in (401, 403) else
                        'provider_quota' if response.status in (402, 429) else
                        'provider_model' if response.status in (400, 404) else 'provider_unavailable')
                raise AIError(code, 429 if response.status == 429 else 502)
            result = read_structured_response(response, deadline)
            if not isinstance(result, dict) or result.get('error'):
                raise AIError('invalid_response')
            if result.get('promptFeedback', {}).get('blockReason'):
                raise AIError('provider_blocked')
            candidates = result.get('candidates', [])
            if not isinstance(candidates, list) or len(candidates) != 1 or candidates[0].get('finishReason') != 'STOP':
                raise AIError('invalid_response')
            parts = candidates[0].get('content', {}).get('parts', [])
            if not isinstance(parts, list) or not parts or any(not isinstance(part, dict) or set(part) - {'text', 'thought', 'thoughtSignature'} for part in parts):
                raise AIError('invalid_response')
            answer = ''.join(part['text'] for part in parts if not part.get('thought'))
            return structured_json(answer)
        except (socket.timeout, TimeoutError):
            raise AIError('timeout', 504) from None
        except (OSError, http.client.HTTPException):
            raise AIError('provider_unavailable', 503) from None
        except (ValueError, TypeError, KeyError, AttributeError, IndexError):
            raise AIError('invalid_response') from None
        finally:
            connection.close()

    def stream(self, messages, search=False):
        deadline = time.monotonic() + self.config.total_timeout
        for provider in self.attempts():
            if time.monotonic() >= deadline:
                raise AIError('timeout', 504)
            emitted = False
            source = provider._stream(messages, search, deadline)
            try:
                for event in source:
                    emitted = True
                    yield event
                return
            except AIError as error:
                if emitted or error.code != 'provider_quota' or error.status != 429:
                    raise
                last_error = error
            finally:
                source.close()
        raise last_error

    def _stream(self, messages, search, deadline):
        if not self.key:
            raise AIError('provider_missing', 503)
        host, path, headers, payload = self.request(messages, search=search)
        connection = http.client.HTTPSConnection(host, timeout=self.config.timeout)
        answer = thinking = 0
        complete = False
        try:
            connection.request('POST', path, body=json.dumps(payload, ensure_ascii=False).encode(), headers=headers)
            response = connection.getresponse()
            if response.status != 200:
                code = ('provider_auth' if response.status in (401, 403) else
                        'provider_quota' if response.status in (402, 429) else
                        'provider_model' if response.status in (400, 404) else 'provider_unavailable')

                raise AIError(code, 429 if response.status == 429 else 502)
            if 'text/event-stream' not in response.getheader('Content-Type', ''):
                raise AIError('invalid_response')
            for raw in sse(response, deadline):
                if raw == '[DONE]':
                    break
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise AIError('invalid_response')
                if data.get('error'):
                    raise AIError('provider_unavailable')
                chunks = []
                if data.get('promptFeedback', {}).get('blockReason'):
                    raise AIError('provider_blocked')
                candidates = data.get('candidates', [])
                if not candidates:
                    continue
                candidate = candidates[0]
                if search and candidate.get('groundingMetadata'):
                    from .web_search import grounding_metadata
                    yield {'type': 'grounding', 'data': grounding_metadata(candidate['groundingMetadata'])}
                for part in candidate.get('content', {}).get('parts', []):
                    if 'text' in part:
                        chunks.append(('thinking' if part.get('thought') else 'delta', part['text']))
                reason = candidate.get('finishReason')
                if reason:
                    if reason != 'STOP':
                        raise AIError('invalid_response' if reason == 'MAX_TOKENS' else 'provider_blocked')
                    complete = True
                for kind, value in chunks:
                    if not isinstance(value, str):
                        raise AIError('invalid_response')
                    if kind == 'thinking':
                        thinking += len(value)
                    else:
                        answer += len(value)
                    if thinking > 48000 or answer > 16000:
                        raise AIError('invalid_response')
                    if value:
                        yield {'type': kind, 'text': value}
                if complete:
                    break
            if not complete or not answer:
                raise AIError('invalid_response')
        except (socket.timeout, TimeoutError):
            raise AIError('timeout', 504) from None
        except (OSError, http.client.HTTPException):
            raise AIError('provider_unavailable', 503) from None
        except (ValueError, TypeError, KeyError, AttributeError, IndexError):
            raise AIError('invalid_response') from None
        finally:
            connection.close()
