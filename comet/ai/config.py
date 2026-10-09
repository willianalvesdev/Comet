import os
import re
from dataclasses import dataclass
from urllib.parse import urlsplit




def is_local_model(value):
    return (isinstance(value, str) and value not in ('gemini', 'qwen')
            and len(value) <= 200 and '://' not in value and 'cloud' not in value.lower()
            and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:/-]*', value) is not None)


def is_provider(value):
    return value in ('gemini', 'qwen') or is_local_model(value)


@dataclass(frozen=True)
class AIConfig:
    base_url: str
    model: str
    timeout: float = 120
    total_timeout: float = 300
    max_messages: int = 39
    max_message_chars: int = 8000
    max_history_chars: int = 48000

    @classmethod
    def from_env(cls):
        return cls(os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434').rstrip('/'),
                   os.getenv('OLLAMA_MODEL', 'qwen3:1.7b'),
                   float(os.getenv('OLLAMA_TIMEOUT_SECONDS', '120')))

    def __post_init__(self):
        url = urlsplit(self.base_url)

        if (url.scheme != 'http' or url.hostname not in ('localhost', '127.0.0.1', '::1')
                or url.username or url.password or url.path or url.query or url.fragment):
            raise ValueError('OLLAMA_BASE_URL deve apontar para HTTP local, sem caminho ou credenciais.')
        if not self.model or 'cloud' in self.model.lower() or not 1 <= self.timeout <= 300:
            raise ValueError('Configure um modelo local e um timeout entre 1 e 300 segundos.')
