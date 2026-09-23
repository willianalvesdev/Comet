import unittest
from unittest.mock import Mock, patch, MagicMock

from ascenda import create_app
from ascenda.news import NewsError, NewsService, normalize_article, public_url, fetch_marketaux
from urllib.error import HTTPError


def article(**overrides):
    return dict(dict(title='Mercado &amp; economia', url='https://example.com/noticia',
                     description='<b>Resumo</b> da notícia', source='example.com',
                     image_url='https://example.com/foto.jpg', published_at='2026-09-23T12:00:00Z',
                     similar=[]), **overrides)


class NewsTests(unittest.TestCase):
    def test_political_news_are_filtered(self):
        for title in ('Trump anuncia tarifas', 'Eleições afetam a bolsa',
                      'Senado vota projeto', 'Governo anuncia pacote', 'Debate político'):
            self.assertIsNone(normalize_article(article(title=title)))
        for title in ('Política monetária e juros', 'Presidente da empresa divulga balanço',
                      'Como investir em renda fixa', 'Bolsa registra alta'):
            self.assertIsNotNone(normalize_article(article(title=title)))
        self.assertIsNone(normalize_article(article(description='Lula comenta a economia')))
        item = normalize_article(article(similar=[{
            'title': 'Trump anuncia tarifas', 'source': 'outro.com', 'url': 'https://outro.com/a'}]))
        self.assertEqual(len(item['sources']), 1)

    def test_normalization_and_safe_links(self):
        item = normalize_article(article(similar=[{'source': 'outro.com', 'url': 'https://outro.com/a'},
                                                  {'source': 'outro.com', 'url': 'https://outro.com/b'}]))
        self.assertEqual(item['title'], 'Mercado & economia')
        self.assertEqual(item['description'], 'Resumo da notícia')
        self.assertEqual(len(item['sources']), 2)
        for url in ('javascript:alert(1)', 'data:text/html,x', 'http://localhost/x',
                    'http://127.0.0.1/x', 'https://user:pass@example.com'):
            self.assertIsNone(public_url(url))
        self.assertIsNone(normalize_article(article(url='javascript:alert(1)')))
        self.assertIsNone(normalize_article(article(image_url='data:bad'))['image'])

    def test_missing_token_does_not_request(self):
        fetcher = Mock()
        with self.assertRaises(NewsError) as error:
            NewsService('', fetcher).get(1)
        self.assertEqual(error.exception.code, 'configuration')
        fetcher.assert_not_called()

    def test_cache_pagination_and_stale_fallback(self):
        clock = Mock(return_value=0)
        fetcher = Mock(return_value={'data': [article(), article()], 'meta': {'found': 9, 'limit': 3}})
        service = NewsService('private-token', fetcher, clock)
        result = service.get(1)
        self.assertTrue(result['has_more'])
        self.assertEqual(len(result['articles']), 1)
        service.get(1)
        self.assertEqual(fetcher.call_count, 1)
        clock.return_value = 1900
        fetcher.side_effect = NewsError('quota', 'Limite atingido')
        self.assertTrue(service.get(1)['stale'])
        service.get(1)
        self.assertEqual(fetcher.call_count, 2)
        clock.return_value = 90000
        with self.assertRaises(NewsError):
            service.get(1)

    def test_provider_errors_do_not_leak_token(self):
        for status, expected in ((401, 'configuration'), (429, 'quota'), (500, 'unavailable')):
            opener = Mock()
            opener.open.side_effect = HTTPError('https://api.marketaux.com/?api_token=secret', status, 'secret', {}, None)
            with patch('ascenda.news.build_opener', return_value=opener):
                with self.assertRaises(NewsError) as caught:
                    fetch_marketaux('secret', 1)
            self.assertEqual(caught.exception.code, expected)
            self.assertNotIn('secret', str(caught.exception))

    def test_routes_require_session_and_handle_configuration(self):
        app = create_app({'TESTING': True, 'SECRET_KEY': 'test-' * 10,
                          'MARKETAUX_API_TOKEN': '', 'RATELIMIT_ENABLED': False})
        client = app.test_client()
        self.assertEqual(client.get('/descobrir.html').status_code, 302)
        self.assertEqual(client.get('/api/news').status_code, 401)
        with client.session_transaction() as session:
            session['auth_token'] = 'test-token'
        manager = MagicMock()
        manager.__enter__.return_value.fetchone.return_value = {'id': 7, 'nome': 'Teste', 'email': 'teste@example.com'}
        with patch('ascenda.db.cursor', return_value=manager):
            self.assertEqual(client.get('/descobrir.html').status_code, 200)
            for page in ('0', '-1', '11', 'abc'):
                self.assertEqual(client.get('/api/news?page=' + page).status_code, 400)
            response = client.get('/api/news')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json['code'], 'configuration')
            app.extensions['ascenda_news'].token = 'server-only'
            app.extensions['ascenda_news'].fetcher = Mock(return_value={'data': [article()], 'meta': {'found': 1, 'limit': 3}})
            response = client.get('/api/news')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json['articles']), 1)
            self.assertFalse(response.json['has_more'])
            self.assertNotIn('server-only', response.get_data(as_text=True))


if __name__ == '__main__':
    unittest.main()
