import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from mysql.connector import IntegrityError

from comet import create_app
from comet.finance import history, receive, summarize, validate_transaction


class FinanceTests(unittest.TestCase):
    def payload(self, **changes):
        return {'external_id':'bank-001', 'kind':'income', 'amount':'100.10',
                'description':'Salário', 'category':'Trabalho', 'occurred_on':'2026-01-15', **changes}

    def test_exact_amounts_and_validation(self):
        self.assertEqual(validate_transaction(self.payload())['amount'], Decimal('100.10'))
        for value in ['NaN', 'Infinity', '-1', '0', '1.001', '1e3', '1,50', 12.5, True, '1000000000000']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_transaction(self.payload(amount=value))
        for fields in [{'occurred_on':'2999-01-01'}, {'occurred_on':'2026-02-30'}, {'occurred_on':'20260115'}, {'kind':'transfer'}, {'usuario_id':9}, {'external_id':''}]:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                validate_transaction(self.payload(**fields))

    def test_summary_balance_expenses_comparison_and_daily_carry(self):
        rows = [
            {'kind':'income','amount':Decimal('100.10'),'occurred_on':date(2026,1,31)},
            {'kind':'expense','amount':Decimal('10.05'),'occurred_on':date(2026,2,1)},
            {'kind':'income','amount':Decimal('0.20'),'occurred_on':date(2026,2,1)},
            {'kind':'income','amount':Decimal('5.00'),'occurred_on':date(2026,2,3)}]
        data=summarize(rows,date(2026,2,4))
        self.assertEqual(data['summary']['balance']['amount'],'95.25')
        self.assertEqual(data['summary']['income']['amount'],'5.20')
        self.assertEqual(data['summary']['expense']['amount'],'10.05')
        self.assertEqual(data['summary']['balance']['difference'],'-4.85')
        self.assertIsNone(data['summary']['expense']['percentage'])
        points=data['chart']['points']
        self.assertEqual(len(points),5)
        self.assertEqual(points[1]['open'],100.1)
        self.assertEqual(points[1]['low'],90.05)
        self.assertEqual(points[1]['close'],90.25)
        self.assertEqual(points[2]['close'],90.25)
        self.assertEqual(points[-1]['close'],95.25)
        self.assertEqual(points[-1]['volume'],0)

    def test_empty_negative_and_leap_day(self):
        empty=summarize([],date(2024,2,29))
        self.assertEqual(empty['chart']['points'],[])
        self.assertEqual(empty['summary']['balance']['amount'],'0.00')
        self.assertEqual(len(empty['summary']['income']['series']),29)
        data=summarize([{'kind':'expense','amount':Decimal('4.25'),'occurred_on':date(2024,2,29)}],date(2024,3,1))
        self.assertEqual(data['summary']['balance']['amount'],'-4.25')
        self.assertEqual(data['summary']['balance']['difference'],'0.00')
        self.assertEqual(data['summary']['expense']['difference'],'-4.25')

    def test_receive_is_parameterized_and_idempotent(self):
        with patch('comet.finance.db.cursor') as managed:
            cursor=managed.return_value.__enter__.return_value
            cursor.lastrowid=23
            row,created=receive(7,self.payload(description="O'Reilly"))
            self.assertTrue(created)
            self.assertEqual(row['id'],'23')
            sql,values=cursor.execute.call_args_list[0].args
            self.assertNotIn("O'Reilly",sql)
            self.assertEqual(values[0],7)
            self.assertIn("O'Reilly",values)
            self.assertIn("finance_transaction_events", cursor.execute.call_args_list[1].args[0])
            self.assertEqual(cursor.execute.call_args_list[1].args[1][3], "TRANSACTION_CREATED")
        with patch('comet.finance.db.cursor') as managed:
            cursor=managed.return_value.__enter__.return_value
            cursor.execute.side_effect=[IntegrityError(errno=1062),None]
            cursor.fetchone.return_value={'id':23,**validate_transaction(self.payload())}
            row,created=receive(7,self.payload())
            self.assertFalse(created)
            self.assertEqual(row['id'],'23')
            self.assertEqual(cursor.execute.call_args.args[1],(7,'bank-001'))
        with patch('comet.finance.db.cursor') as managed:
            cursor=managed.return_value.__enter__.return_value
            cursor.execute.side_effect=[IntegrityError(errno=1062),None]
            cursor.fetchone.return_value={'id':23,**validate_transaction(self.payload(amount='99.00'))}
            self.assertEqual(receive(7,self.payload()),(None,False))

    def test_history_cursor_is_owned_and_stable(self):
        with patch('comet.finance.db.cursor') as managed:
            cursor=managed.return_value.__enter__.return_value
            values=validate_transaction(self.payload())
            cursor.fetchall.return_value=[{'id':2,**values},{'id':1,**values}]
            page=history(7,1,'2026-01-16:9')
            self.assertEqual(page['next_cursor'],'2026-01-15:2')
            self.assertEqual(page['transactions'][0]['id'],'2')
            self.assertEqual(cursor.execute.call_args.args[1][0],7)
            self.assertIn('ORDER BY occurred_on DESC, id DESC',cursor.execute.call_args.args[0])
        for limit,before in [(0,None),(101,None),(2,'bad'),(2,'2026-01-01:-1')]:
            with self.assertRaises(ValueError):history(7,limit,before)


class FinanceRouteTests(unittest.TestCase):
    def setUp(self):
        self.app=create_app({'TESTING':True,'SECRET_KEY':'finance-test-'*4,'WTF_CSRF_ENABLED':False,'RATELIMIT_ENABLED':False})
        self.client=self.app.test_client()

    def sign_in(self):
        with self.client.session_transaction() as session:session['auth_token']='test-token'

    def test_authentication_and_csrf(self):
        self.assertEqual(self.client.get('/api/finance/dashboard').status_code,401)
        self.assertEqual(self.client.post('/api/finance/transactions',json={}).status_code,401)
        self.app.config['WTF_CSRF_ENABLED']=True
        self.assertEqual(self.client.post('/api/finance/transactions',json={}).status_code,400)

    def test_user_is_taken_from_session_and_response_is_private(self):
        self.sign_in()
        with patch('comet.db.mysql.connector.connect') as connect, patch('comet.finance.dashboard',return_value={'summary':{}}) as dashboard:
            connect.return_value.cursor.return_value.fetchone.return_value={'id':7,'nome':'Teste','email':'t@example.com'}
            response=self.client.get('/api/finance/dashboard?usuario_id=99')
            self.assertEqual(response.status_code,200)
            dashboard.assert_called_once_with(7)
            self.assertEqual(response.headers['Cache-Control'],'no-store')
            connect.return_value.close.assert_called_once()

    def test_text_transaction_routes_are_removed(self):
        rules = {rule.rule for rule in self.app.url_map.iter_rules()}
        self.assertNotIn('/api/finance/transactions/from-text', rules)
        self.assertNotIn('/api/finance/transactions/delete', rules)

    def test_ingestion_statuses(self):
        self.sign_in()
        with patch('comet.db.mysql.connector.connect') as connect, patch('comet.finance.receive') as receive_mock:
            connect.return_value.cursor.return_value.fetchone.return_value={'id':7,'nome':'Teste','email':'t@example.com'}
            for result,code in [(({'id':'1'},True),201),(({'id':'1'},False),200),((None,False),409)]:
                receive_mock.return_value=result
                self.assertEqual(self.client.post('/api/finance/transactions',json={}).status_code,code)
            receive_mock.side_effect=ValueError('Inválido')
            self.assertEqual(self.client.post('/api/finance/transactions',json={}).status_code,422)


class FinanceTitleTests(unittest.TestCase):
    def test_titles_keep_location_and_details_without_sentence(self):
        from comet.finance import transaction_title
        for source,expected in [('Gastei 67 reais no mercado ontem','Mercado'),('gastei 200 reais no presente do ravi','Presente do Ravi'),('farmácia','Farmácia'),('ganhei 200 reais','Ganhei'),('ganhei 200 reais ontem','Ganhei'),('Presente do Ravi','Presente do Ravi'),('Compra no iFood','Compra no iFood')]:
            with self.subTest(source=source):self.assertEqual(transaction_title(source),expected)
