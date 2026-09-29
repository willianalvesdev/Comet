import unittest
from unittest.mock import patch,MagicMock
from datetime import datetime,timezone
from ascenda.ai.response_policy import current_context,without_source_list
from ascenda.ai.config import AIConfig,LOCAL_MODELS
from ascenda.ai.service import ComputerService

class ResponsePolicyTests(unittest.TestCase):
    def test_current_date_is_dynamic_and_explicit(self):
        with patch('ascenda.ai.response_policy.datetime') as clock:
            clock.now.return_value=datetime(2028,2,4,12,tzinfo=timezone.utc)
            context=current_context()
        self.assertIn('04/02/2028',context)
        self.assertIn('ano atual 2028',context)
        self.assertIn('Não trate 2028 como futuro',context)

    def test_citations_removed_without_modifying_code(self):
        text='Informação [1].\n\n```python\na = [1]\n```\n\nFontes:\n[1] https://example.com'
        result=without_source_list(text)
        self.assertIn('Informação.',result)
        self.assertIn('a = [1]',result)
        self.assertNotIn('https://example.com',result)
        self.assertEqual(without_source_list('Resposta.\n\n**Fontes:**\n- Site'), 'Resposta.')

    def test_saved_response_is_sent_only_after_generation_completes(self):
        local=MagicMock(); stage=[]
        def stream(messages):
            yield {'type':'delta','text':'Primeira '}
            stage.append('second')
            yield {'type':'delta','text':'segunda'}
            stage.append('complete')
        local.stream.side_effect=stream
        service=ComputerService(local,AIConfig('http://localhost:11434',LOCAL_MODELS[0]))
        store=MagicMock();store.begin.return_value={'conversation_id':'1','turn_id':'2','messages':[{'role':'user','content':'Oi'}]}
        events=service.stream_saved(1,{},store)
        self.assertEqual(next(events)['type'],'conversation')
        first=next(events)
        self.assertEqual(stage,['second','complete'])
        self.assertEqual(first,{'type':'delta','text':'Primeira segunda'})
        self.assertEqual(next(events)['type'],'done')
        self.assertEqual(store.save.call_args.args[-1],'completed')
