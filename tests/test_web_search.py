import io
import json
import unittest
from unittest.mock import MagicMock, patch

from comet.ai.config import AIConfig, LOCAL_MODELS
from comet.ai.errors import AIError
from comet.ai.ollama import OllamaProvider, ContextSizeError
from comet.ai.remote import RemoteProvider
from comet.ai.response_metadata import pack_response, unpack_response
from comet.ai.service import ComputerService
from comet.ai.web_search import WebSearch, grounding_metadata, requires_web, with_web

CONFIG = AIConfig("http://localhost:11434", LOCAL_MODELS[0])
SOURCE = {"sources": [{"url": "https://example.com/news", "title": "Example", "domain": "example.com"}],
          "queries": ["notícias"], "suggestions": ""}


class WebSearchTests(unittest.TestCase):
    def test_explicit_search_variants_force_research(self):
        for text in ['pesquisa sobre carros','quero pesquisar as novidades','pode buscar na internet','procure um carro','search for current prices']:
            self.assertTrue(requires_web(text), text)
        self.assertFalse(requires_web('Não pesquise na internet'))

    def setUp(self):
        environment = patch.dict('os.environ', {'SEARXNG_URL':'', 'BRAVE_SEARCH_API_KEY':''})
        environment.start()
        self.addCleanup(environment.stop)

    def provider(self, events):
        provider = MagicMock()
        provider.key = "test-key"
        provider.stream.side_effect = lambda *args, **kwargs: iter(events)

        def stream(*args, **kwargs):
            yield from events
        provider.stream.side_effect = stream
        return provider

    def test_grounding_is_explicit_and_rejects_unsafe_or_duplicate_sources(self):
        raw = {"groundingChunks": [
            {"web": {"uri": "javascript:alert(1)"}}, {"web": {"uri": "https://127.0.0.1/admin"}},
            {"web": {"uri": "https://user:pass@example.com/x"}},
            {"web": {"uri": "https://example.com/news", "title": "example.com"}},
            {"web": {"uri": "https://example.com/news", "title": "duplicada"}}]}
        data = grounding_metadata(raw)
        self.assertEqual(len(data["sources"]), 1)
        self.assertEqual(data["sources"][0]["domain"], "example.com")

    def test_real_grounding_metadata_is_parsed_from_gemini_stream(self):
        frames = [
            {"candidates": [{"content": {"parts": [{"text": "Fato verificado"}]}}]},
            {"candidates": [{"groundingMetadata": {
                "groundingChunks": [{"web": {"uri": "https://example.com/news", "title": "example.com"}}],
                "webSearchQueries": ["teste"],
                "searchEntryPoint": {"renderedContent": "<div>Google</div>"}},
                "finishReason": "STOP"}]}]
        response = io.BytesIO(b"".join(("data: " + json.dumps(frame) + "\n\n").encode() for frame in frames))
        response.status = 200
        response.getheader = lambda *_: "text/event-stream"
        connection = MagicMock()
        connection.getresponse.return_value = response
        with patch("comet.ai.remote.http.client.HTTPSConnection", return_value=connection):
            provider = RemoteProvider("gemini", "secret-test", "gemini-3.8-flash", CONFIG)
            events = list(provider.stream([{"role":"system","content":"test"},{"role":"user","content":"test"}], search=True))
        body = json.loads(connection.request.call_args.kwargs["body"])
        self.assertEqual(body["tools"], [{"google_search": {}}])
        self.assertEqual(events[-1]["data"]["sources"][0]["domain"], "example.com")
        self.assertEqual(events[-1]["data"]["suggestions"], "<div>Google</div>")

    def test_no_sources_does_not_pass_ungrounded_model_prose_as_evidence(self):
        provider = self.provider([{"type":"delta","text":"INVENTED"}])
        runner = WebSearch(provider).run("teste")
        events = []
        try:
            while True:
                events.append(next(runner))
        except StopIteration as stopped:
            context = stopped.value
        self.assertEqual(events[-1]["state"], "empty")
        self.assertNotIn("INVENTED", context)

    def test_failed_search_is_visible(self):
        provider = self.provider([])
        provider.key = ""
        with patch.dict("os.environ", {"BRAVE_SEARCH_API_KEY":""}):
            events = list(WebSearch(provider).run("teste"))
        self.assertEqual(events[-1]["state"], "failed")
        self.assertEqual(events[-1]["sources"], [])
        provider.stream.assert_not_called()

    def test_explicit_search_and_opt_out(self):
        self.assertTrue(requires_web("Pesquise os lançamentos desta semana"))
        self.assertTrue(requires_web("Qual a cotação do dólar?"))
        self.assertFalse(requires_web("Não pesquise na internet, explique juros"))
        self.assertFalse(requires_web("Olá, tudo bem?"))

    def test_local_model_searches_before_generating_even_without_explicit_request(self):
        local = self.provider([{"type":"delta","text":"Resposta com evidência [1]."}])
        remote = self.provider([])
        service = ComputerService(local, CONFIG)
        service.web_search = WebSearch(remote)
        with patch("comet.ai.web_search.searxng_search", return_value=({**SOURCE,"engine":"SearXNG"}, "Fato")) as search:
            events = list(with_web(service, [{"role":"user","content":"Uma pergunta factual"}], local, ""))
        search.assert_called_once_with("Uma pergunta factual")
        local.stream.assert_called_once()
        remote.stream.assert_not_called()
        self.assertEqual(events[0]['type'], 'search')
        self.assertIn("example.com", local.stream.call_args.args[0][0]['content'])
        self.assertEqual(events[-1]['text'], "Resposta com evidência [1].")

    def test_local_model_answers_when_automatic_search_is_unavailable(self):
        local = self.provider([{"type":"delta","text":"Resposta sem pesquisa."}])
        service = ComputerService(local, CONFIG)
        service.web_search = WebSearch(self.provider([]))
        with patch("comet.ai.web_search.searxng_search", side_effect=AIError('provider_missing',503)):
            events = list(with_web(service,[{'role':'user','content':'Explique juros'}],local,''))
        self.assertTrue(any(e.get('state')=='failed' for e in events))
        self.assertEqual(events[-1]['text'],'Resposta sem pesquisa.')
        local.stream.assert_called_once()

    def test_opt_out_never_executes_model_tool_marker(self):
        local = self.provider([{"type":"delta","text":"Resposta"}])
        service = ComputerService(local, CONFIG)
        service.web_search = MagicMock()
        list(with_web(service,[{"role":"user","content":"Sem pesquisar, explique juros"}],local,""))
        service.web_search.run.assert_not_called()

    def test_instruct_model_does_not_send_thinking_option(self):
        provider = OllamaProvider(AIConfig(CONFIG.base_url, "qwen3:4b-instruct-2507-q4_K_M"))
        show = io.BytesIO(json.dumps({"thinking":{"values":[False]}}).encode())
        chat = io.BytesIO(b'{"message":{"content":"Oi"},"done":true}\n')
        with patch.object(provider, "_connect"), patch.object(provider, "_post", side_effect=[show,chat]) as request:
            self.assertEqual(list(provider.stream([{"role":"user","content":"Oi"}])), [{"type":"delta","text":"Oi"}])
        self.assertNotIn("think", request.call_args.args[2])
        self.assertEqual(request.call_args.args[2]["model"], "qwen3:4b-instruct-2507-q4_K_M")

    def test_context_reduces_input_instead_of_growing_memory(self):
        provider = OllamaProvider(CONFIG)
        show = io.BytesIO(json.dumps({"model_info":{"qwen3.context_length":262144}}).encode())
        chat = io.BytesIO(b'{"message":{"content":"OK"},"done":true}\n')
        contexts = []
        sizes = []
        def post(connection, path, payload):
            if path == "/api/show":
                return show
            contexts.append(payload["options"]["num_ctx"])
            sizes.append(len(payload["messages"][-1]["content"]))
            if len(contexts) == 1:
                raise ContextSizeError(35000)
            return chat
        with patch.object(provider, "_connect"), patch.object(provider, "_post", side_effect=post):
            self.assertEqual(list(provider.stream([{"role":"user","content":"Teste"*4000}])), [{"type":"delta","text":"OK"}])
        self.assertEqual(contexts, [4096,4096])
        self.assertLess(sizes[1],sizes[0])

    def test_context_error_is_detected_without_echoing_server_body(self):
        response = io.BytesIO(json.dumps({"error":json.dumps({"error":{
            "type":"exceed_context_size_error","n_prompt_tokens":23765,"message":"private prompt"}})}).encode())
        response.status = 400
        connection = MagicMock()
        connection.getresponse.return_value = response
        with self.assertRaises(ContextSizeError) as caught:
            OllamaProvider(CONFIG)._post(connection, "/api/chat", {})
        self.assertEqual(caught.exception.required,23765)
        self.assertNotIn("private prompt",str(caught.exception))

    def test_instant_uses_full_response_duration_and_no_thinking(self):
        for elapsed, expected in [(2.999, True), (3, False), (4, False)]:
            local = self.provider([{"type":"delta","text":"Oi"}])
            service = ComputerService(local, CONFIG)
            store = MagicMock()
            store.begin.return_value = {"conversation_id":"1","turn_id":"2","messages":[{"role":"user","content":"Oi"}]}
            with patch("comet.ai.service.time.perf_counter", side_effect=[0,elapsed]):
                events = list(service.stream_saved(1, {}, store))
            self.assertEqual(events[-1]["metadata"]["instant"], expected)
            self.assertEqual(store.save.call_args.args[-1], "completed")
            self.assertEqual(store.begin.return_value["response_meta"], events[-1]["metadata"])

    def test_fast_thinking_response_is_not_instant(self):
        local = self.provider([{"type":"thinking","text":"Resumo"},{"type":"delta","text":"Oi"}])
        service = ComputerService(local, CONFIG)
        store = MagicMock()
        store.begin.return_value = {"conversation_id":"1","turn_id":"2","messages":[{"role":"user","content":"Oi"}]}
        with patch("comet.ai.service.time.perf_counter", side_effect=[0,.1,.2,.3]):
            events=list(service.stream_saved(1,{},store))
        self.assertFalse(events[-1]["metadata"]["instant"])

    def test_metadata_round_trip_and_legacy_thoughts(self):
        metadata = {"instant":True,"research":{"state":"complete",**SOURCE}}
        self.assertEqual(unpack_response(pack_response("Resumo",metadata)),("Resumo",metadata))
        self.assertEqual(unpack_response("Pensamento antigo"),("Pensamento antigo",{}))

    def test_enabled_local_models_route_explicit_search_only_to_searxng(self):
        for name in ('qwen', *LOCAL_MODELS):
            with self.subTest(model=name):
                local = self.provider([{'type':'delta','text':'Resposta'}])
                google = self.provider([])
                service = ComputerService(local,CONFIG, {name:local,'gemini':google})
                service.web_search = WebSearch(google)
                with patch('comet.ai.web_search.searxng_search',return_value=({**SOURCE,'engine':'SearXNG'},'Fato')) as search:
                    events=list(with_web(service,[{'role':'user','content':'Pesquise notícias hoje'}],local,''))
                search.assert_called_once()
                google.stream.assert_not_called()
                self.assertEqual(next(e for e in events if e['type']=='search')['engine'],'SearXNG')

    def test_gemini_search_never_uses_searxng_even_if_configured(self):
        google = self.provider([{'type':'delta','text':'Fato'}, {'type':'grounding','data':SOURCE}])
        service = ComputerService(google,CONFIG)
        service.web_search = WebSearch(google)
        with patch.dict('os.environ',{'SEARXNG_URL':'http://127.0.0.1:8888'}), patch('comet.ai.web_search.searxng_search') as local_search:

            source=with_web(service,[{'role':'user','content':'Pesquise notícias hoje'}],google,'')
            try:
                for event in source:
                    if event['type']=='search' and event['state']=='complete':break
            finally:source.close()
        local_search.assert_not_called()
        self.assertTrue(google.stream.call_args.kwargs['search'])
        self.assertEqual(event['engine'],'Google Search')

    def test_google_quota_never_falls_back_to_searxng(self):
        google=self.provider([])
        google.stream.side_effect=AIError('provider_quota',429)
        with patch('comet.ai.web_search.searxng_search') as local_search:
            events=list(WebSearch(google).run('notícias hoje',engine='google'))
        local_search.assert_not_called()
        self.assertEqual(events[-1]['state'],'failed')
        self.assertEqual(events[-1]['engine'],'Google Search')

    def test_empty_local_results_never_call_google(self):
        google=self.provider([])
        with patch('comet.ai.web_search.searxng_search',return_value=({'sources':[],'engine':'SearXNG'},'')):
            events=list(WebSearch(google).run('notícias hoje',engine='searxng'))
        google.stream.assert_not_called()
        self.assertEqual(events[-1]['state'],'empty')

    def test_attachment_switch_to_gemini_also_switches_search(self):
        local=self.provider([])
        google=self.provider([])
        def stream(messages,search=False):
            if search:
                yield {'type':'grounding','data':SOURCE}
            yield {'type':'delta','text':'Resposta'}
        google.stream.side_effect=stream
        service=ComputerService(local,CONFIG,{'qwen':local,'gemini':google})
        service.web_search=WebSearch(google)
        store=MagicMock()
        store.begin.return_value={'conversation_id':'1','turn_id':'2','has_attachments':True,
                                 'messages':[{'role':'user','content':'Pesquise notícias hoje'}]}
        with patch('comet.ai.web_search.searxng_search') as sx:
            events=list(service.stream_saved(1,{'provider':'qwen'},store))
        sx.assert_not_called()
        local.stream.assert_not_called()
        self.assertEqual(events[0]['provider'],'gemini')
        self.assertEqual(events[-1]['metadata']['research']['engine'],'Google Search')

    def test_small_and_instruct_qwen_models_can_search_again(self):
        from dataclasses import replace
        for model in ('qwen3:1.7b','qwen3:1.7b-q4_K_M','qwen3:4b-instruct-2507-q4_K_M'):
            with self.subTest(model=model):
                local=OllamaProvider(replace(CONFIG,model=model))
                google=self.provider([])
                service=ComputerService(local,CONFIG,{'qwen':local,'gemini':google})
                service.web_search=WebSearch(google)
                def stream(messages):
                    yield {'type':'delta','text':'Resposta pesquisada'}
                with patch.object(local,'stream',side_effect=stream), patch('comet.ai.web_search.searxng_search',return_value=({**SOURCE,'engine':'SearXNG'},'Fato')) as search:
                    events=list(with_web(service,[{'role':'user','content':'Pesquise notícias hoje'}],local,''))
                search.assert_called_once()
                google.stream.assert_not_called()
                self.assertTrue(any(e['type']=='search' for e in events))

    def test_local_model_catalog_contains_only_qwen(self):
        self.assertEqual(LOCAL_MODELS,('qwen3:1.7b','qwen3:4b','qwen3:8b','qwen3:4b-instruct-2507-q4_K_M'))
