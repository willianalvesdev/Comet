import io
import json
import os
import unittest
from datetime import datetime,timedelta,timezone
from email.utils import format_datetime
from unittest.mock import MagicMock,patch
from urllib.parse import parse_qs,urlsplit
from ascenda.ai.search_engines import diversified,news_search,searxng_search,brave_search,result_date
from ascenda.ai.local_context import fit_messages,LOCAL_PROMPT
from ascenda.ai.web_search import WebSearch,search_query
from ascenda.ai.ollama import OllamaProvider
from ascenda.ai.service import ComputerService
from ascenda.ai.config import AIConfig
from ascenda.ai.errors import AIError

class SearchEngineTests(unittest.TestCase):
    def test_search_query_excludes_output_instructions(self):
        self.assertEqual(search_query('Pesquise notícias de IA hoje e resuma duas manchetes citando fontes.'),'notícias de IA hoje')

    def test_domain_diversity_and_unsafe_links(self):
        items=[{'url':f'https://a.com/{i}'} for i in range(10)] + [{'url':'https://b.com/1'},{'url':'https://c.com/1'},{'url':'https://127.0.0.1/a'}]
        result=diversified(items)
        self.assertEqual([r['domain'] for r in result],['a.com','b.com','c.com','a.com'])

    def test_news_rejects_old_and_undated_results(self):
        now=datetime.now(timezone.utc)
        def item(name,date):
            return f'<item><title>{name}</title><link>https://news.google.com/{name}</link><source url="https://{name}.com">{name}</source><pubDate>{date}</pubDate></item>'
        raw=('<rss><channel>'+item('fresh',format_datetime(now-timedelta(hours=1)))+item('old',format_datetime(now-timedelta(days=10)))+item('unknown','')+'</channel></rss>').encode()
        with patch('ascenda.ai.search_engines.read',return_value=raw) as read:
            result,notes=news_search('notícias hoje')
        self.assertEqual(len(result['sources']),1)
        self.assertEqual(result['sources'][0]['domain'],'fresh.com')
        self.assertIn('when%3A1d',read.call_args.args[1])
        self.assertEqual(result['sources'][0]['evidence_type'],'headline')

    def test_searxng_date_and_json_parameters(self):
        now=datetime.now(timezone.utc)
        data={'results':[{'url':'https://a.com/1','title':'Atual','content':'Trecho','publishedDate':now.isoformat()},
                         {'url':'https://b.com/1','title':'Velha','publishedDate':(now-timedelta(days=50)).isoformat()}]}
        response=io.BytesIO(json.dumps(data).encode()); response.status=200
        conn=MagicMock(); conn.getresponse.return_value=response
        with patch.dict(os.environ,{'SEARXNG_URL':'http://127.0.0.1:8888'}), patch('ascenda.ai.search_engines.http.client.HTTPConnection',return_value=conn):
            result,notes=searxng_search('notícias hoje')
        params=parse_qs(urlsplit(conn.request.call_args.args[1]).query)
        self.assertEqual(params['format'],['json'])
        self.assertNotIn('time_range',params)
        self.assertEqual(params['categories'],['news'])
        self.assertEqual(len(result['sources']),1)

    def test_brave_sets_date_filter_and_does_not_put_key_in_url(self):
        with patch.dict(os.environ,{'BRAVE_SEARCH_API_KEY':'secret'}), patch('ascenda.ai.search_engines.read',return_value=b'{"web":{"results":[]}}') as read:
            brave_search('notícias hoje')
        self.assertIn('freshness=pd',read.call_args.args[1])
        self.assertNotIn('secret',read.call_args.args[1])

    def test_local_context_keeps_latest_and_complete_recent_pairs(self):
        history=[{'role':'system','content':LOCAL_PROMPT}]
        for i in range(20):
            history.extend([{'role':'user','content':f'Pergunta {i} '+'a'*400},{'role':'assistant','content':'b'*400}])
        history.append({'role':'user','content':'Pedido final'})
        result=fit_messages(history,6144)
        self.assertEqual(result[-1]['content'],'Pedido final')
        self.assertLess(len(result),len(history))
        self.assertEqual(result[1]['role'],'user')
        self.assertEqual(len(history),42)
        self.assertLess(sum(len(m['content'].encode()) for m in result),6144)

    def test_service_sends_compact_prompt_only_to_local_provider(self):
        provider=OllamaProvider(AIConfig('http://localhost:11434','qwen3:4b'))
        def stream(messages):
            yield {'type':'delta','text':'OK'}
        with patch.object(provider,'stream',side_effect=stream) as call:
            list(ComputerService(provider,provider.config).generate([{'role':'user','content':'Oi'}]))
        system=call.call_args.args[0][0]['content']
        self.assertIn(LOCAL_PROMPT,system)
        self.assertLess(len(system),2500)

    def test_searxng_failure_never_falls_back_to_google(self):
        provider=MagicMock(); provider.key='configured'
        with patch('ascenda.ai.web_search.searxng_search',side_effect=AIError('provider_unavailable')) as sx:
            events=list(WebSearch(provider).run('notícias hoje',engine='searxng'))
        sx.assert_called_once()
        provider.stream.assert_not_called()
        self.assertEqual(events[-1]['state'],'failed')
        self.assertEqual(events[-1]['engine'],'SearXNG')

    def test_relative_provider_dates_are_approximate(self):
        now=datetime.now(timezone.utc)
        for label,hours in [('Há 40 minutos | Jornal',40/60),('há 3 horas',3),('2 hours ago',2)]:
            date,approximate=result_date({'metadata':label},now)
            self.assertTrue(approximate)
            self.assertAlmostEqual((now-date).total_seconds(),hours*3600)
        self.assertEqual(result_date({'metadata':'sem data'},now),(None,False))
