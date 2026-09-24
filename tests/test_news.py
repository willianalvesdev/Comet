import unittest
from unittest.mock import Mock, patch, MagicMock

from ascenda import create_app
from ascenda.news import NewsError, NewsService, normalize_article, public_url, fetch_newsapi
from urllib.error import HTTPError


def article(**overrides):
    return dict(dict(title='Mercado &amp; economia', url='https://example.com/noticia',
                     description='<b>Resumo</b> da notícia', source={'name': 'example.com'},
                     urlToImage='https://example.com/foto.jpg', publishedAt='2026-09-23T12:00:00Z',
                     similar=[]), **overrides)


class NewsTests(unittest.TestCase):
    def test_general_topics_and_politics_are_allowed(self):
        for title in ('Eleições afetam a bolsa', 'Governo anuncia pacote',
                      'Violinista lança álbum', 'Novo robô ajuda estudantes',
                      'Football team wins', 'Celebrity wedding today'):
            self.assertIsNotNone(normalize_article(article(title=title)))

    def test_normalization_and_safe_links(self):
        item = normalize_article(article())
        self.assertEqual(item['title'], 'Mercado & economia')
        self.assertEqual(item['description'], 'Resumo da notícia')
        self.assertEqual(len(item['sources']), 1)
        for url in ('javascript:alert(1)', 'data:text/html,x', 'http://localhost/x',
                    'http://127.0.0.1/x', 'https://user:pass@example.com'):
            self.assertIsNone(public_url(url))
        self.assertIsNone(normalize_article(article(url='javascript:alert(1)')))
        self.assertIsNone(normalize_article(article(urlToImage='data:bad')))
        self.assertIsNone(normalize_article(article(urlToImage=None)))
        self.assertIsNone(normalize_article(article(urlToImage='')))

    def test_crime_violence_and_adult_filter(self):
        for title in ('Stock market earnings grow', 'Banco aumenta lucro',
                      'Inversiones y finanzas', 'Bourse et inflation', 'Aktien und Banken'):
            self.assertIsNotNone(normalize_article(article(title=title)))
        for title in ('Pornografia na internet', 'Guerra e bombardeios',
                      'Bank robbery under police investigation', 'Fraude em investimentos',
                      'Bolsa cai após assassinato', 'Finanzas y estafa',
                      'Tiroteio deixa feridos'):
            self.assertIsNone(normalize_article(article(title=title)))
        self.assertIsNone(normalize_article(article(content='Police arrested a suspect')))

    def test_provider_request_and_response(self):
        import json
        from urllib.parse import parse_qs, urlsplit
        from ascenda.news import news_query
        self.assertLessEqual(len(news_query()), 500)
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {'status': 'ok', 'totalResults': 1, 'articles': [article()]}).encode()
        opener = Mock()
        opener.open.return_value = response
        with patch('ascenda.news.build_opener', return_value=opener):
            payload = fetch_newsapi('private-secret', 2)
        request = opener.open.call_args.args[0]
        query = parse_qs(urlsplit(request.full_url).query)
        self.assertEqual(request.get_header('X-api-key'), 'private-secret')
        self.assertNotIn('private-secret', request.full_url)
        self.assertEqual(query['language'], ['en'])
        self.assertEqual(opener.open.call_count, 2)
        first_query = parse_qs(urlsplit(opener.open.call_args_list[0].args[0].full_url).query)
        self.assertEqual(first_query['language'], ['pt'])
        self.assertNotIn('country', query)
        self.assertEqual(query['page'], ['2'])
        self.assertEqual(query['pageSize'], ['100'])
        self.assertEqual(len(payload['articles']), 2)
        with patch('ascenda.news.build_opener', return_value=opener):
            fetch_newsapi('private-secret', 1, languages='all')
        self.assertNotIn('language', parse_qs(urlsplit(opener.open.call_args.args[0].full_url).query))

    def test_topics_and_cache_are_isolated(self):
        from ascenda.news import news_query, topic_selection
        self.assertEqual(topic_selection('sports,business,sports'), ('business', 'sports'))
        with self.assertRaises(ValueError):
            topic_selection('unknown')
        self.assertIn('football', news_query(('sports',)))
        self.assertNotIn('finance', news_query(('sports',)))
        fetcher = Mock(return_value={'articles': [article()], 'totalResults': 1})
        service = NewsService('test', fetcher)
        service.get(1, ('sports',))
        service.get(1, ('business',))
        service.get(1, ('sports',))
        service.get(1, (), 'top')
        service.get(1, (), 'top', 'all')
        self.assertEqual(fetcher.call_count, 4)

    def test_missing_token_does_not_request(self):
        fetcher = Mock()
        with self.assertRaises(NewsError) as error:
            NewsService('', fetcher).get(1)
        self.assertEqual(error.exception.code, 'configuration')
        fetcher.assert_not_called()

    def test_cache_pagination_and_stale_fallback(self):
        clock = Mock(return_value=0)
        fetcher = Mock(return_value={'articles': [article(), article()], 'totalResults': 300})
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
            opener.open.side_effect = HTTPError('https://newsapi.org/v2/everything', status, 'secret', {}, None)
            with patch('ascenda.news.build_opener', return_value=opener):
                with self.assertRaises(NewsError) as caught:
                    fetch_newsapi('secret', 1)
            self.assertEqual(caught.exception.code, expected)
            self.assertNotIn('secret', str(caught.exception))

    def test_routes_require_session_and_handle_configuration(self):
        app = create_app({'TESTING': True, 'SECRET_KEY': 'test-' * 10,
                          'NEWS_API_KEY': '', 'RATELIMIT_ENABLED': False})
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
            self.assertEqual(client.get('/api/news?topics=invalid').status_code, 400)
            self.assertEqual(client.get('/api/news?mode=invalid').status_code, 400)
            response = client.get('/api/news')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json['code'], 'configuration')
            app.extensions['ascenda_news'].token = 'server-only'
            app.extensions['ascenda_news'].fetcher = Mock(return_value={'articles': [article()], 'totalResults': 1})
            response = client.get('/api/news')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json['articles']), 1)
            self.assertFalse(response.json['has_more'])
            self.assertNotIn('server-only', response.get_data(as_text=True))


if __name__ == '__main__':
    unittest.main()
