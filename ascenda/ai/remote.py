"""Private, bounded HTTPS streaming to the Gemini API."""
import http.client
import json
import os
import re
import socket
import time

from .errors import AIError


def sse(response, deadline):
    """SSE framing allows comments and multiple data lines, with bounded memory."""
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


class RemoteProvider:
    def __init__(self, name, key, model, config):
        if name not in ('gemini',) or not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', model):
            raise ValueError('Configure um identificador de modelo válido para Gemini.')
        self.name, self.key, self.model, self.config = name, key.strip(), model, config
        self.label = 'Gemini'

    @classmethod
    def from_env(cls, name, config):
        return cls(name, os.getenv('GEMINI_API_KEY', ''),
                   os.getenv('GEMINI_MODEL', 'gemini-3.8-flash'), config)

    def request(self, messages):
        identity = f'\nModelo desta resposta: {self.model}. Provedor: {self.label}. Processamento via API externa.'
        system = messages[0]['content'] + identity
        headers = {'Content-Type': 'application/json', 'Accept': 'text/event-stream'}
        headers['x-goog-api-key'] = self.key
        payload = {'systemInstruction': {'parts': [{'text': system}]},
                   'contents': [{'role': 'model' if m['role'] == 'assistant' else 'user',
                                 'parts': [{'text': m['content']}]} for m in messages[1:]],
                   'generationConfig': {'maxOutputTokens': 8192,
                                        'thinkingConfig': {'includeThoughts': True}}}
        return ('generativelanguage.googleapis.com',
                f'/v1beta/models/{self.model}:streamGenerateContent?alt=sse', headers, payload)

    def stream(self, messages):
        if not self.key:
            raise AIError('provider_missing', 503)
        host, path, headers, payload = self.request(messages)
        connection = http.client.HTTPSConnection(host, timeout=self.config.timeout)
        deadline = time.monotonic() + self.config.total_timeout
        answer = thinking = 0
        complete = False
        try:
            connection.request('POST', path, body=json.dumps(payload, ensure_ascii=False).encode(), headers=headers)
            response = connection.getresponse()
            if response.status != 200:
                code = ('provider_auth' if response.status in (401, 403) else
                        'provider_quota' if response.status in (402, 429) else
                        'provider_model' if response.status in (400, 404) else 'provider_unavailable')
                # Never forward vendor error bodies: they may contain credentials or user data.
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
