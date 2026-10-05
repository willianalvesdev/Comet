from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
import sqlite3
import json
import unittest
from unittest.mock import patch
from uuid import uuid4

from flask import g
from comet import create_app


class FinanceExecutionIntegrationTests(unittest.TestCase):
    def setUp(self):
        clock = patch('comet.finance.today_local', return_value=date(2026, 10, 2))
        clock.start()
        self.addCleanup(clock.stop)
        self.connection = sqlite3.connect(':memory:')
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript("""
            CREATE TABLE finance_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL,
                external_id TEXT NOT NULL, kind TEXT NOT NULL, amount TEXT NOT NULL,
                description TEXT NOT NULL, category TEXT NOT NULL, occurred_on TEXT NOT NULL,
                deleted_at TEXT NULL, UNIQUE(usuario_id, external_id));
            CREATE TABLE finance_operations (usuario_id INTEGER, operation_id TEXT,
                request_hash TEXT, result TEXT NULL, PRIMARY KEY(usuario_id, operation_id));
            CREATE TABLE finance_transaction_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL,
                operation_id TEXT NULL, transaction_id INTEGER NOT NULL, event TEXT NOT NULL,
                occurred_at TEXT NOT NULL, before_json TEXT NULL, after_json TEXT NULL);
        """)
        self.sql = []
        self.account = 7
        self.app = create_app({'TESTING': True, 'SECRET_KEY': 'finance-execution-test-' * 3,
                               'WTF_CSRF_ENABLED': False, 'RATELIMIT_ENABLED': False})
        @self.app.before_request
        def signed_in():
            g.user = {'id': self.account} if self.account else None
        self.client = self.app.test_client()
        self.patch = patch('comet.db.cursor', self.cursor)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.addCleanup(self.connection.close)

    @contextmanager
    def cursor(self, write=False):
        connection, statements = self.connection, self.sql
        class Cursor:
            def execute(self, sql, values=()):
                statements.append((sql, values))
                translated = sql.replace('%s', '?').replace(' FOR UPDATE', '').replace('UTC_TIMESTAMP(6)', "'2026-10-01 12:00:00.000001'")
                translated = translated.replace('ON DUPLICATE KEY UPDATE operation_id=VALUES(operation_id)', 'ON CONFLICT(usuario_id,operation_id) DO NOTHING')
                self.current = connection.execute(translated, tuple(str(v) if isinstance(v, (Decimal, date)) else v for v in values))
                self.lastrowid = self.current.lastrowid
            def convert(self, row):
                if row is None:
                    return None
                row = dict(row)
                if 'amount' in row: row['amount'] = Decimal(row['amount'])
                if 'occurred_on' in row: row['occurred_on'] = date.fromisoformat(row['occurred_on'])
                if row.get('deleted_at'): row['deleted_at'] = datetime.fromisoformat(row['deleted_at'])
                return row
            def fetchone(self): return self.convert(self.current.fetchone())
            def fetchall(self): return [self.convert(row) for row in self.current.fetchall()]
        try:
            yield Cursor()
            if write: connection.commit()
        except BaseException:
            if write: connection.rollback()
            raise

    def transaction(self, **changes):
        return {'kind':'expense', 'amount':'80.00', 'description':'Mercado', 'category':'Alimentação', 'occurred_on':'2026-09-30', **changes}

    def execute(self, actions, operation_id=None):
        return self.client.post('/api/finance/actions', json={'operation_id': operation_id or str(uuid4()), 'actions': actions})

    def create(self, **changes):
        response = self.execute([{'type':'create', 'transaction':self.transaction(**changes)}])
        self.assertEqual(response.status_code, 200, response.json)
        return response.json['operations'][0]['transaction_ids'][0]

    def operation(self, kind, identifier, **fields):
        return {'type':kind, 'transaction_ids':[identifier], **fields}

    def listing(self, state='active'):
        response = self.client.get('/api/finance/transactions?state=' + state)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json['transactions']

    def test_complete_lifecycle_keeps_id_and_excludes_trash_from_every_total(self):
        identifier = self.create()
        self.assertIsNone(self.listing()[0]['deleted_at'])
        self.assertEqual(self.execute([self.operation('update', identifier, changes={'amount':'90.01'})]).status_code, 200)
        self.assertEqual(self.listing()[0]['amount'], '90.01')
        self.assertEqual(self.client.get('/api/finance/dashboard').json['summary']['balance']['amount'], '-90.01')
        self.assertEqual(self.execute([self.operation('delete', identifier)]).status_code, 200)
        self.assertEqual(self.listing(), [])
        self.assertEqual(self.listing('deleted')[0]['id'], identifier)
        self.assertIsNotNone(self.listing('deleted')[0]['deleted_at'])
        dashboard = self.client.get('/api/finance/dashboard').json
        self.assertEqual(dashboard['chart']['points'], [])
        for card in dashboard['summary'].values():
            self.assertEqual(card['amount'], '0.00')
            self.assertEqual(card['difference'], '0.00')
            self.assertTrue(all(value == 0 for value in card['series']))
        self.assertEqual(self.execute([self.operation('restore', identifier)]).status_code, 200)
        self.assertEqual(self.listing()[0]['id'], identifier)
        self.assertEqual(self.listing('deleted'), [])
        self.assertEqual(self.listing()[0]['amount'], '90.01')
        self.assertEqual(self.client.get('/api/finance/dashboard').json['summary']['balance']['amount'], '-90.01')
        self.assertTrue(any('FOR UPDATE' in sql and 'usuario_id=%s AND id=%s' in sql for sql, _ in self.sql))

    def test_permanent_delete_requires_explicit_request_and_trash(self):
        identifier = self.create()
        permanent = self.operation('permanent_delete', identifier, confirmation='explicit_permanent_delete')
        self.assertEqual(self.execute([self.operation('permanent_delete', identifier)]).status_code, 422)
        self.assertEqual(self.execute([permanent]).status_code, 409)
        self.execute([self.operation('delete', identifier)])
        self.assertEqual(self.execute([permanent]).status_code, 200)
        self.assertEqual(self.listing('deleted'), [])
        self.assertEqual(self.execute([self.operation('restore', identifier)]).status_code, 409)
        self.assertEqual(self.connection.execute('SELECT COUNT(*) FROM finance_transactions').fetchone()[0], 0)

    def test_stale_records_and_other_accounts_are_rejected(self):
        identifier = self.create()
        self.account = 8
        for kind in ['update', 'delete', 'restore', 'permanent_delete']:
            fields = {'changes':{'amount':'1.00'}} if kind == 'update' else {'confirmation':'explicit_permanent_delete'} if kind == 'permanent_delete' else {}
            self.assertEqual(self.execute([self.operation(kind, identifier, **fields)]).status_code, 409)
        self.account = 7
        self.execute([self.operation('delete', identifier)])
        self.assertEqual(self.execute([self.operation('update', identifier, changes={'amount':'1.00'})]).status_code, 409)
        self.assertEqual(self.listing('deleted')[0]['amount'], '80.00')
        self.assertEqual(self.execute([self.operation('delete', identifier)]).status_code, 409)
        self.execute([self.operation('restore', identifier)])
        self.assertEqual(self.execute([self.operation('restore', identifier)]).status_code, 409)

    def test_batch_is_atomic_and_retry_is_idempotent(self):
        operation_id = str(uuid4())
        actions = [{'type':'create', 'transaction':self.transaction(amount='0.10')}, {'type':'create', 'transaction':self.transaction(kind='income', amount='0.20')}]
        first = self.execute(actions, operation_id)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json, self.execute(actions, operation_id).json)
        self.assertEqual(len(self.listing()), 2)
        self.assertEqual(self.client.get('/api/finance/dashboard').json['summary']['balance']['amount'], '0.10')
        self.assertEqual(self.execute(actions[:1], operation_id).status_code, 409)
        identifier = self.listing()[0]['id']
        deletion_id = str(uuid4())
        deletion = [self.operation('delete', identifier)]
        first = self.execute(deletion, deletion_id)
        self.assertEqual(first.json, self.execute(deletion, deletion_id).json)
        failure = self.execute([actions[0], self.operation('update', identifier, changes={'amount':'2.00'})])
        self.assertEqual(failure.status_code, 409)
        self.assertEqual(len(self.listing()) + len(self.listing('deleted')), 2)
        self.assertEqual(self.connection.execute('SELECT COUNT(*) FROM finance_operations').fetchone()[0], 2)

    def test_batch_updates_roll_back_if_any_record_is_missing(self):
        identifier = self.create()
        response = self.execute([{'type':'update', 'transaction_ids':[identifier,'999'], 'changes':{'amount':'1.00'}}])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.listing()[0]['amount'], '80.00')

    def test_every_target_is_checked_before_any_financial_write(self):
        identifier = self.create()
        self.sql.clear()
        response = self.execute([
            {'type': 'create', 'transaction': self.transaction(amount='67.00')},
            self.operation('update', identifier, changes={'amount': '0'}),
        ])
        self.assertEqual(response.status_code, 422)
        self.assertFalse(any(sql.startswith(('INSERT INTO finance_transactions ', 'UPDATE finance_transactions ',
                                            'DELETE FROM finance_transactions ', 'INSERT INTO finance_transaction_events '))
                             for sql, _ in self.sql))
        self.assertEqual(self.listing()[0]['amount'], '80.00')
        self.assertEqual(len(self.events()), 1)

    def test_valid_mixed_batch_locks_all_targets_before_changes(self):
        first, second = self.create(), self.create(description='Farmácia')
        self.sql.clear()
        response = self.execute([
            {'type': 'create', 'transaction': self.transaction(amount='67.00')},
            self.operation('update', second, changes={'amount': '75.00'}),
            self.operation('delete', first),
        ])
        self.assertEqual(response.status_code, 200)
        locks = [index for index, (sql, _) in enumerate(self.sql) if sql.startswith('SELECT * FROM finance_transactions')]
        writes = [index for index, (sql, _) in enumerate(self.sql) if sql.startswith(('INSERT INTO finance_transactions ', 'UPDATE finance_transactions '))]
        self.assertEqual(len(locks), 2)
        self.assertLess(max(locks), min(writes))
        self.assertEqual([values[1] for sql, values in self.sql if sql.startswith('SELECT * FROM finance_transactions')], [first, second])
        self.assertEqual(len(self.listing()), 2)
        self.assertEqual(self.listing('deleted')[0]['id'], first)

    def test_all_fields_are_validated_and_no_sql_injection(self):
        identifier = self.create(description="O'Reilly")
        for changes in [{'amount':'0'}, {'amount':12}, {'amount':'1.001'}, {'amount':'-1'}, {'occurred_on':'2026-02-30'}, {'occurred_on':'2999-01-01'}, {'deleted_at':None}, {'usuario_id':8}, {'external_id':'x'}]:
            with self.subTest(changes=changes):
                self.assertEqual(self.execute([self.operation('update', identifier, changes=changes)]).status_code, 422)
        self.assertEqual(self.listing()[0]['amount'], '80.00')
        self.assertEqual(self.execute([self.operation('delete', '1 OR 1=1')]).status_code, 422)
        self.assertEqual(self.execute([self.operation('delete', identifier), self.operation('restore', identifier)]).status_code, 422)
        self.assertEqual(self.client.get('/api/finance/transactions?state=all').status_code, 422)

    def test_auth_csrf_and_private_response(self):
        self.account = None
        self.assertEqual(self.execute([]).status_code, 401)
        self.account = 7
        response = self.execute([{'type':'create', 'transaction':self.transaction()}])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.app.config['WTF_CSRF_ENABLED'] = True
        self.assertEqual(self.execute([]).status_code, 400)

    def events(self):
        rows = self.connection.execute('SELECT * FROM finance_transaction_events WHERE usuario_id=? ORDER BY id', (self.account,)).fetchall()
        return [{**dict(row), 'before': json.loads(row['before_json']) if row['before_json'] else None,
                 'after': json.loads(row['after_json']) if row['after_json'] else None} for row in rows]

    def test_audit_lifecycle_stores_only_changed_fields_and_survives_permanent_deletion(self):
        identifier = self.create()
        created = self.events()[0]
        self.assertEqual(created['event'], 'TRANSACTION_CREATED')
        self.assertIsNone(created['before'])
        self.assertEqual(created['after'], self.transaction())
        response = self.execute([self.operation('update', identifier, changes={'amount':'95.00', 'category':'Mercado', 'description':'Mercado'})])
        self.assertEqual(response.status_code, 200)
        updated = self.events()[-1]
        self.assertEqual(updated['event'], 'TRANSACTION_UPDATED')
        self.assertEqual(updated['before'], {'amount':'80.00', 'category':'Alimentação'})
        self.assertEqual(updated['after'], {'amount':'95.00', 'category':'Mercado'})
        self.execute([self.operation('delete', identifier)])
        deleted = self.events()[-1]
        self.assertEqual(deleted['event'], 'TRANSACTION_DELETED')
        self.assertEqual(deleted['before'], {'deleted_at':None})
        self.assertEqual(deleted['after']['deleted_at'], self.listing('deleted')[0]['deleted_at'])
        self.assertEqual(datetime.fromisoformat(deleted['occurred_at']).isoformat() + 'Z', deleted['after']['deleted_at'])
        self.execute([self.operation('restore', identifier)])
        restored = self.events()[-1]
        self.assertEqual(restored['event'], 'TRANSACTION_RESTORED')
        self.assertEqual(restored['before'], deleted['after'])
        self.assertEqual(restored['after'], {'deleted_at':None})
        self.execute([self.operation('delete', identifier)])
        self.execute([self.operation('permanent_delete', identifier, confirmation='explicit_permanent_delete')])
        events = self.events()
        self.assertEqual(len(events), 6)
        self.assertTrue(all(str(event['transaction_id']) == identifier for event in events))
        self.assertEqual(events[-1]['event'], 'TRANSACTION_PERMANENTLY_DELETED')
        self.assertIsNone(events[-1]['before'])
        self.assertIsNone(events[-1]['after'])
        self.assertEqual(self.listing(), [])
        self.assertEqual(self.client.get('/api/finance/dashboard').json['summary']['balance']['amount'], '0.00')

    def test_audit_retry_rollback_and_noop(self):
        operation_id = str(uuid4())
        actions = [{'type':'create', 'transaction':self.transaction()}]
        response = self.execute(actions, operation_id)
        self.execute(actions, operation_id)
        self.assertEqual(len(self.events()), 1)
        identifier = response.json['operations'][0]['transaction_ids'][0]
        self.assertEqual(self.events()[0]['operation_id'], operation_id)
        failure = self.execute([self.operation('update', identifier, changes={'amount':'95.00'}), self.operation('delete','999')])
        self.assertEqual(failure.status_code, 409)
        self.assertEqual(len(self.events()), 1)
        self.assertEqual(self.listing()[0]['amount'], '80.00')
        self.execute([self.operation('update', identifier, changes={'amount':'80.00'})])
        self.assertEqual(self.events()[-1]['before'], {})
        self.assertEqual(self.events()[-1]['after'], {})
        self.account = 8
        self.assertEqual(self.events(), [])

    def test_audit_failure_rolls_back_data_and_idempotency_record(self):
        with patch('comet.finance_execution.record_event', side_effect=RuntimeError('audit unavailable')):
            with self.assertRaises(RuntimeError):
                self.create()
        self.assertEqual(self.listing(), [])
        self.assertEqual(self.events(), [])
        self.assertEqual(self.connection.execute('SELECT COUNT(*) FROM finance_operations').fetchone()[0], 0)

    def test_ingestion_is_audited_and_audit_is_not_a_financial_source(self):
        response = self.client.post('/api/finance/transactions', json={**self.transaction(), 'external_id':'import-1'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(self.events()), 1)
        self.assertIsNone(self.events()[0]['operation_id'])
        self.assertEqual(self.events()[0]['event'], 'TRANSACTION_CREATED')
        before = self.client.get('/api/finance/dashboard').json
        self.connection.execute("UPDATE finance_transaction_events SET after_json=?", (json.dumps({'amount':'999999.99'}),))
        self.connection.commit()
        self.assertEqual(self.client.get('/api/finance/dashboard').json, before)
        self.assertEqual(self.listing()[0]['amount'], '80.00')

    def test_income_expense_trash_and_restore_recompute_the_same_month_and_chart(self):
        income = self.create(kind='income', amount='1500.00', occurred_on='2026-10-01')
        expense = self.create(amount='67.25', occurred_on='2026-10-01')
        original = self.client.get('/api/finance/dashboard').json
        self.assertEqual(original['summary']['balance']['amount'], '1432.75')
        self.assertEqual(original['summary']['income']['amount'], '1500.00')
        self.assertEqual(original['summary']['expense']['amount'], '67.25')
        self.assertEqual(original['chart']['points'][-1]['close'], 1432.75)
        self.assertEqual(self.execute([self.operation('delete', expense)]).status_code, 200)
        without_expense = self.client.get('/api/finance/dashboard').json
        self.assertEqual(without_expense['summary']['balance']['amount'], '1500.00')
        self.assertEqual(without_expense['summary']['expense']['amount'], '0.00')
        self.assertEqual(without_expense['chart']['points'][-1]['close'], 1500.0)
        self.assertEqual(self.execute([self.operation('delete', income)]).status_code, 200)
        empty = self.client.get('/api/finance/dashboard').json
        self.assertEqual(empty['summary']['balance']['amount'], '0.00')
        self.assertEqual(empty['summary']['income']['amount'], '0.00')
        self.assertEqual(empty['chart']['points'], [])
        self.assertEqual(self.execute([{'type': 'restore', 'transaction_ids': [income, expense]}]).status_code, 200)
        self.assertEqual(self.client.get('/api/finance/dashboard').json, original)
        self.assertEqual({row['id'] for row in self.listing()}, {income, expense})

    def test_failure_after_second_write_rolls_back_entire_batch_and_all_audit_events(self):
        from comet.finance_audit import record_event
        first = self.create()
        operation_id = str(uuid4())
        actions = [self.operation('update', first, changes={'amount': '90.00'}),
                   {'type': 'create', 'transaction': self.transaction(amount='67.00')}]
        calls = 0
        def fail_second_event(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError('simulated audit storage failure')
            return record_event(*args, **kwargs)
        with patch('comet.finance_execution.record_event', side_effect=fail_second_event):
            with self.assertRaises(RuntimeError):
                self.execute(actions, operation_id)
        self.assertEqual(calls, 2)
        self.assertEqual(len(self.listing()), 1)
        self.assertEqual(self.listing()[0]['amount'], '80.00')
        self.assertEqual(len(self.events()), 1)
        self.assertEqual(self.connection.execute('SELECT COUNT(*) FROM finance_operations').fetchone()[0], 1)
        self.assertEqual(self.execute(actions, operation_id).status_code, 200)
        self.assertEqual(len(self.listing()), 2)
        self.assertEqual(len(self.events()), 3)

    def test_invalid_last_create_prevents_every_financial_write(self):
        for fields in [{'amount': 'NaN'}, {'amount': 'Infinity'}, {'amount': '1e3'},
                       {'amount': True}, {'amount': '0.001'}, {'amount': '1000000000000.00'},
                       {'occurred_on': '2025-02-29'}, {'occurred_on': '2026-04-31'},
                       {'occurred_on': '2026-10-03'}, {'occurred_on': '1969-12-31'},
                       {'description': ' '}, {'kind': 'transfer'}]:
            with self.subTest(fields=fields):
                self.sql.clear()
                response = self.execute([{'type': 'create', 'transaction': self.transaction()},
                                         {'type': 'create', 'transaction': self.transaction(**fields)}])
                self.assertEqual(response.status_code, 422)
                self.assertFalse(self.sql)
        self.assertEqual(self.listing(), [])
        self.assertEqual(self.events(), [])

    def test_leap_day_minimum_and_maximum_amounts_are_preserved_exactly(self):
        for amount in ['0.01', '999999999999.99']:
            identifier = self.create(amount=amount, occurred_on='2024-02-29', category='Categoria nova')
            row = next(row for row in self.listing() if row['id'] == identifier)
            self.assertEqual(row['amount'], amount)
            self.assertEqual(row['occurred_on'], '2024-02-29')
            self.assertEqual(row['category'], 'Categoria nova')
        self.assertEqual(self.client.get('/api/finance/dashboard').json['summary']['balance']['amount'], '-1000000000000.00')

    def test_malformed_ids_and_conflicting_actions_never_reach_database(self):
        for identifier in [None, True, 1, '', '0', '-1', '01', '1.0', '1 OR 1=1', '18446744073709551616']:
            with self.subTest(identifier=identifier):
                self.sql.clear()
                self.assertEqual(self.execute([self.operation('delete', identifier)]).status_code, 422)
                self.assertFalse(self.sql)
        for actions in [[{'type': 'delete', 'transaction_ids': ['1', '1']}],
                        [self.operation('update', '1', changes={'amount': '5.00'}), self.operation('delete', '1')],
                        [{'type': 'create', 'transaction': self.transaction()}] * 101]:
            with self.subTest(actions=actions):
                self.sql.clear()
                self.assertEqual(self.execute(actions).status_code, 422)
                self.assertFalse(self.sql)

    def test_deleting_another_accounts_record_rolls_back_valid_create_in_same_batch(self):
        identifier = self.create()
        self.account = 8
        response = self.execute([{'type': 'create', 'transaction': self.transaction()}, self.operation('delete', identifier)])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.listing(), [])
        self.assertEqual(self.events(), [])
        self.account = 7
        self.assertEqual(self.listing()[0]['id'], identifier)
        self.assertIsNone(self.listing()[0]['deleted_at'])
        self.assertEqual(len(self.events()), 1)


    def create_many(self, count=151):
        identifiers = []
        actions = [{'type': 'create', 'transaction': self.transaction(
            kind='income' if index % 2 == 0 else 'expense',
            amount='100.00' if index % 2 == 0 else '20.00',
            occurred_on='2025-12-31' if index % 3 == 0 else '2026-10-01',
        )} for index in range(count)]
        for start in range(0, len(actions), 100):
            response = self.execute(actions[start:start + 100])
            self.assertEqual(response.status_code, 200, response.json)
            identifiers.extend(operation['transaction_ids'][0] for operation in response.json['operations'])
        return identifiers

    def test_delete_all_and_undo_over_100_transactions_keep_ids_balances_and_other_accounts(self):
        identifiers = self.create_many()
        old_trash = self.create(amount='999.99')
        self.assertEqual(self.execute([self.operation('delete', old_trash)]).status_code, 200)
        self.account = 8
        foreign_id = self.create(amount='45.00')
        self.account = 7
        original = self.client.get('/api/finance/dashboard').json
        self.assertEqual(original['summary']['balance']['amount'], '6100.00')
        event_count = len(self.events())
        operation_id = str(uuid4())
        deletion = [{'type': 'delete', 'transaction_ids': identifiers}]
        response = self.execute(deletion, operation_id)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['operations'], deletion)
        self.assertEqual(self.execute(deletion, operation_id).json, response.json)
        self.assertEqual(len(self.events()), event_count + len(identifiers))
        self.assertEqual(self.connection.execute(
            'SELECT COUNT(*) FROM finance_transactions WHERE usuario_id=7 AND deleted_at IS NULL').fetchone()[0], 0)
        self.assertEqual(self.connection.execute(
            'SELECT COUNT(*) FROM finance_transactions WHERE usuario_id=7 AND deleted_at IS NOT NULL').fetchone()[0], 152)
        empty = self.client.get('/api/finance/dashboard').json
        self.assertTrue(all(card['amount'] == '0.00' for card in empty['summary'].values()))
        self.assertEqual(empty['chart']['points'], [])
        restoration = [{'type': 'restore', 'transaction_ids': identifiers}]
        restore_id = str(uuid4())
        restored = self.execute(restoration, restore_id)
        self.assertEqual(restored.status_code, 200, restored.json)
        self.assertEqual(restored.json['operations'], restoration)
        self.assertEqual(self.execute(restoration, restore_id).json, restored.json)
        self.assertEqual(len(self.events()), event_count + 2 * len(identifiers))
        active = self.connection.execute(
            'SELECT id FROM finance_transactions WHERE usuario_id=7 AND deleted_at IS NULL').fetchall()
        self.assertEqual({str(row['id']) for row in active}, set(identifiers))
        self.assertEqual(self.listing('deleted')[0]['id'], old_trash)
        self.assertEqual(self.client.get('/api/finance/dashboard').json, original)
        self.account = 8
        self.assertEqual(self.listing()[0]['id'], foreign_id)
        self.assertIsNone(self.listing()[0]['deleted_at'])
        self.assertEqual(self.client.get('/api/finance/dashboard').json['summary']['balance']['amount'], '-45.00')

    def test_large_delete_revalidates_every_target_and_never_partially_applies(self):
        identifiers = self.create_many()
        old_trash = self.create()
        self.execute([self.operation('delete', old_trash)])
        self.account = 8
        foreign_id = self.create()
        self.account = 7
        original = self.client.get('/api/finance/dashboard').json
        events = len(self.events())
        operations = self.connection.execute('SELECT COUNT(*) FROM finance_operations').fetchone()[0]
        for invalid_id in ['999999', old_trash, foreign_id]:
            with self.subTest(invalid_id=invalid_id):
                self.sql.clear()
                response = self.execute([{'type': 'delete', 'transaction_ids': identifiers + [invalid_id]}])
                self.assertEqual(response.status_code, 409, response.json)
                self.assertFalse(any(sql.startswith(('UPDATE finance_transactions ', 'DELETE FROM finance_transactions ',
                                                    'INSERT INTO finance_transaction_events ')) for sql, _ in self.sql))
                self.assertEqual(len(self.events()), events)
                self.assertEqual(self.connection.execute('SELECT COUNT(*) FROM finance_operations').fetchone()[0], operations)
                self.assertEqual(self.client.get('/api/finance/dashboard').json, original)

    def test_large_batch_exception_only_allows_single_delete_or_restore_and_keeps_request_size_limit(self):
        identifiers = [str(value) for value in range(1, 152)]
        for actions in [
            [{'type': 'update', 'transaction_ids': identifiers, 'changes': {'amount': '1.00'}}],
            [{'type': 'permanent_delete', 'transaction_ids': identifiers, 'confirmation': 'explicit_permanent_delete'}],
            [{'type': 'delete', 'transaction_ids': identifiers[:100]}, {'type': 'delete', 'transaction_ids': identifiers[100:]}],
            [{'type': 'delete', 'transaction_ids': identifiers}, {'type': 'create', 'transaction': self.transaction()}],
            [{'type': 'restore', 'transaction_ids': identifiers[:100]}, {'type': 'restore', 'transaction_ids': identifiers[100:]}],
        ]:
            with self.subTest(actions=actions):
                self.sql.clear()
                self.assertEqual(self.execute(actions).status_code, 422)
                self.assertFalse(self.sql)
        self.sql.clear()
        self.assertEqual(self.execute([{'type': 'delete', 'transaction_ids': [str(value) for value in range(1, 15000)]}]).status_code, 413)
        self.assertFalse(self.sql)
