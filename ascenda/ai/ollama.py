import http.client
import json
import logging
import time
from urllib.parse import urlsplit

from .errors import AIError
from .local_context import fit_messages

log = logging.getLogger(__name__)
MAX_LINE = 65536


class ContextSizeError(AIError):
    def __init__(self, required):
        super().__init__('context_size', 422)
        self.required = required


class OllamaProvider:
    label = 'Qwen'

    def __init__(self, config):
        self.config = config

    def _connect(self):
        url = urlsplit(self.config.base_url)

        host = '127.0.0.1' if url.hostname == 'localhost' else url.hostname
        return http.client.HTTPConnection(host, url.port or 80, timeout=self.config.timeout)

    def _post(self, connection, path, payload):
        connection.request('POST', path, json.dumps(payload).encode('utf-8'),
                           {'Content-Type': 'application/json', 'Accept': 'application/json'})
        response = connection.getresponse()
        if response.status != 200:
            log.warning('Local AI HTTP %s at %s', response.status, path)

            raw_error = response.read(16385)
            if response.status == 400 and len(raw_error) <= 16384:
                try:
                    detail = json.loads(raw_error).get('error')
                    if isinstance(detail, str):
                        detail = json.loads(detail).get('error', {})
                    if isinstance(detail, dict) and detail.get('type') == 'exceed_context_size_error':
                        required = detail.get('n_prompt_tokens')
                        if type(required) is int and 0 < required < 1048576:
                            response.close()
                            raise ContextSizeError(required)
                except (ValueError, TypeError, AttributeError):
                    pass

            response.close()
            if response.status == 404:
                raise AIError('model_missing', 503)
            if response.status in (400, 422):
                raise AIError('incompatible', 503)
            raise AIError('unavailable', 503)
        return response

    def stream(self, messages):
        connection = self._connect()
        started = time.monotonic()
        try:
            with self._post(connection, '/api/show', {'model': self.config.model}) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise AIError('invalid_response')
            info = json.loads(raw)
            if not isinstance(info, dict):
                raise AIError('invalid_response')
            if info.get('remote_model') or info.get('remote_host'):
                raise AIError('incompatible', 503)
            thinking = info.get('thinking') or {}
            values = thinking.get('values', [])
            supports_thinking = not (self.config.model.startswith('gemma3:') or '-instruct-' in self.config.model)
            if supports_thinking and values and not any(value is True for value in values):
                log.warning('Model %s does not support think:true; configure a compatible OLLAMA_MODEL', self.config.model)
                raise AIError('incompatible', 503)
            local_messages = [dict(message) for message in messages]
            if local_messages and local_messages[0]['role'] == 'system':
                local_messages[0]['content'] += f'\nModelo desta resposta: {self.config.model}. Provedor: Ollama local. O processamento acontece no computador que hospeda o Ascenda.'
            payload = {'model': self.config.model, 'messages': local_messages,
                       'stream': True}
            if supports_thinking:
                payload['think'] = True
            limits = [value for key, value in info.get('model_info', {}).items()
                      if key.endswith('.context_length') and type(value) is int and value > 0]
            context_limit = min(min(limits, default=4096), 4096)
            payload['options'] = {'num_ctx': context_limit}
            input_budget = max(512, (context_limit - 1024) * 2)
            payload['messages'] = fit_messages(local_messages, input_budget)
            chars = 0
            received = False
            thinking_chars = 0
            try:
                response = self._post(connection, '/api/chat', payload)
            except ContextSizeError as error:

                ratio = max(0.1, (context_limit - 1024) / error.required)
                payload['messages'] = fit_messages(local_messages, max(512, int(input_budget * min(ratio, 0.7))))
                response = self._post(connection, '/api/chat', payload)
            with response:
                while True:
                    if time.monotonic() - started > self.config.total_timeout:
                        raise AIError('timeout', 504)
                    raw = response.readline(MAX_LINE + 1)
                    if not raw:
                        raise AIError('stream_error')
                    if len(raw) > MAX_LINE:
                        raise AIError('invalid_response')
                    if not raw.strip():
                        continue
                    chunk = json.loads(raw)
                    if not isinstance(chunk, dict):
                        raise AIError('invalid_response')
                    if chunk.get('error'):
                        raise AIError('stream_error')
                    message = chunk.get('message', {})
                    if not isinstance(message, dict) or not isinstance(message.get('content', ''), str):
                        raise AIError('invalid_response')
                    reasoning = message.get('thinking', '')
                    if not isinstance(reasoning, str):
                        raise AIError('invalid_response')
                    if message.get('tool_calls'):
                        raise AIError('incompatible', 503)

                    if reasoning:
                        if received:
                            raise AIError('invalid_response')
                        thinking_chars += len(reasoning)
                        if thinking_chars > 48000:
                            raise AIError('invalid_response')
                        yield {'type': 'thinking', 'text': reasoning}
                    content = message.get('content', '')
                    if content:
                        chars += len(content)
                        if chars > 16000:
                            raise AIError('invalid_response')
                        received = True
                        yield {'type': 'delta', 'text': content}
                    if chunk.get('done') is True:
                        if not received:
                            raise AIError('invalid_response')
                        return
        except AIError:
            raise
        except TimeoutError as exc:
            log.warning('Local AI timeout: %s', type(exc).__name__)
            raise AIError('timeout', 504) from exc
        except (ConnectionError, OSError) as exc:
            log.warning('Local AI connection failed: %s', type(exc).__name__)
            raise AIError('unavailable', 503) from exc
        except (ValueError, TypeError, AttributeError, http.client.HTTPException) as exc:
            log.warning('Invalid local AI response: %s', type(exc).__name__)
            raise AIError('invalid_response') from exc
        finally:
            connection.close()
