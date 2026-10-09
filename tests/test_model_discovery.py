import json
import unittest
from unittest.mock import Mock, patch
from comet.ai.config import AIConfig
from comet.ai.ollama import OllamaProvider
from comet.ai.errors import AIError


class ModelDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.provider = OllamaProvider(AIConfig('http://localhost:11434', 'old-model'))
        self.connection = Mock()
        self.response = self.connection.getresponse.return_value
        self.response.status = 200

    def discover(self, data):
        self.response.read.return_value = json.dumps(data).encode()
        with patch.object(self.provider, '_connect', return_value=self.connection):
            return self.provider.models()

    def test_installed_custom_models_and_duplicates(self):
        self.assertEqual(self.discover({'models': [{'name': name} for name in
            ['qwen3:4b', 'qwen3:1.7b-turbo', 'qwen3:4b']]}),
            ['qwen3:1.7b-turbo', 'qwen3:4b'])
        self.connection.request.assert_called_once_with('GET', '/api/tags', headers={'Accept': 'application/json'})
        self.connection.close.assert_called_once()
        self.assertEqual(self.connection.timeout, 3)

    def test_cloud_and_invalid_entries_excluded(self):
        self.assertEqual(self.discover({'models': [None, {}, {'name': 'x:cloud'},
            {'name': 'gemini'}, {'name': '../bad name'},
            {'name': 'remote', 'remote_host': 'https://example.com'}, {'name': 'local:latest'}]}), ['local:latest'])

    def test_empty_installation(self):
        self.assertEqual(self.discover({'models': []}), [])

    def test_invalid_response(self):
        with self.assertRaises(AIError): self.discover({'models': {}})

    def test_offline_closes_connection(self):
        self.connection.request.side_effect = OSError()
        with patch.object(self.provider, '_connect', return_value=self.connection):
            with self.assertRaises(AIError): self.provider.models()
        self.connection.close.assert_called_once()
