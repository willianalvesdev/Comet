import unittest
from unittest.mock import Mock, patch

from flask import Flask, g

from comet import db
from comet.ai.conversations import ConversationStore, conversation_id
from comet.ai.errors import AIError
from comet.ai.personalization import learn


class DatabaseLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.connection = Mock()
        self.database_cursor = self.connection.cursor.return_value
        self.store = ConversationStore.__new__(ConversationStore)
        self.store.options = {}

    def test_conversation_transaction_commits_and_closes_resources(self):
        with patch('comet.ai.conversations.mysql.connector.connect', return_value=self.connection):
            with self.store.cursor() as database_cursor:
                self.assertIs(database_cursor, self.database_cursor)
        self.connection.commit.assert_called_once_with()
        self.connection.rollback.assert_not_called()
        self.database_cursor.close.assert_called_once_with()
        self.connection.close.assert_called_once_with()

    def test_conversation_cursor_creation_failure_still_closes_connection(self):
        self.connection.cursor.side_effect = RuntimeError('cursor unavailable')
        with patch('comet.ai.conversations.mysql.connector.connect', return_value=self.connection):
            with self.assertRaisesRegex(RuntimeError, 'cursor unavailable'):
                with self.store.cursor():
                    self.fail('Cursor creation should fail before entering the transaction')
        self.connection.commit.assert_not_called()
        self.connection.rollback.assert_called_once_with()
        self.connection.close.assert_called_once_with()

    def test_conversation_cursor_close_failure_still_closes_connection(self):
        self.database_cursor.close.side_effect = RuntimeError('cursor close failed')
        with patch('comet.ai.conversations.mysql.connector.connect', return_value=self.connection):
            with self.assertRaisesRegex(RuntimeError, 'cursor close failed'):
                with self.store.cursor():
                    pass
        self.connection.close.assert_called_once_with()

    def test_commit_failure_rolls_back_and_closes_resources(self):
        self.connection.commit.side_effect = RuntimeError('commit failed')
        with patch('comet.ai.conversations.mysql.connector.connect', return_value=self.connection):
            with self.assertRaisesRegex(RuntimeError, 'commit failed'):
                with self.store.cursor():
                    pass
        self.connection.rollback.assert_called_once_with()
        self.database_cursor.close.assert_called_once_with()
        self.connection.close.assert_called_once_with()

    def test_rollback_failure_still_closes_cursor_and_connection(self):
        self.connection.rollback.side_effect = RuntimeError('rollback failed')
        with patch('comet.ai.conversations.mysql.connector.connect', return_value=self.connection):
            with self.assertRaisesRegex(RuntimeError, 'rollback failed'):
                with self.store.cursor():
                    raise ValueError('statement failed')
        self.database_cursor.close.assert_called_once_with()
        self.connection.close.assert_called_once_with()

    def test_interrupted_write_rolls_back_and_releases_cursor(self):
        with patch('comet.db.get_db', return_value=self.connection):
            with self.assertRaises(GeneratorExit):
                with db.cursor(write=True):
                    raise GeneratorExit()
        self.connection.commit.assert_not_called()
        self.connection.rollback.assert_called_once_with()
        self.database_cursor.close.assert_called_once_with()

    def test_read_cursor_does_not_commit_the_shared_connection(self):
        with patch('comet.db.get_db', return_value=self.connection):
            with db.cursor() as database_cursor:
                self.assertIs(database_cursor, self.database_cursor)
        self.connection.commit.assert_not_called()
        self.connection.rollback.assert_not_called()
        self.connection.close.assert_not_called()
        self.database_cursor.close.assert_called_once_with()

    def test_request_connection_is_reused_and_removed_during_teardown(self):
        app = Flask(__name__)
        app.teardown_appcontext(db.close_db)
        with patch('comet.db.options', return_value={}), patch('comet.db.mysql.connector.connect', return_value=self.connection) as connect:
            with app.app_context():
                self.assertIs(db.get_db(), self.connection)
                self.assertIs(db.get_db(), self.connection)
                connect.assert_called_once_with()
                self.assertIn('db', g)
            self.connection.close.assert_called_once_with()

    def test_search_keeps_sql_metacharacters_in_parameters(self):
        self.database_cursor.fetchall.return_value = []
        query = "%' OR 1=1 --"
        with patch('comet.ai.conversations.mysql.connector.connect', return_value=self.connection):
            self.store.list(7, query=query)
        statement, parameters = self.database_cursor.execute.call_args.args
        self.assertNotIn(query, statement)
        self.assertEqual(parameters, (7, "%!%' OR 1=1 --%", 0))
        self.assertIn('usuario_id=%s', statement)

    def test_invalid_offset_is_rejected_before_opening_a_connection(self):
        for offset in (-1, True, '0'):
            with self.subTest(offset=offset), patch('comet.ai.conversations.mysql.connector.connect') as connect:
                with self.assertRaises(AIError) as failure:
                    self.store.list(7, offset=offset)
                self.assertEqual(failure.exception.code, 'invalid_request')
                connect.assert_not_called()

    def test_id_limits_and_oversized_input_are_handled_as_validation_errors(self):
        self.assertEqual(conversation_id('0001'), '0001')
        self.assertEqual(conversation_id(str(2**64 - 1)), str(2**64 - 1))
        for value in (None, 1, '', '0', '-1', '1 OR 1=1', str(2**64), '9' * 5000):
            with self.subTest(value=str(value)[:30]):
                with self.assertRaises(AIError) as failure:
                    conversation_id(value)
                self.assertEqual(failure.exception.code, 'invalid_request')

    def test_learning_preserves_case_insensitive_deduplication_and_budget(self):
        self.assertEqual(learn('', 'Sou designer. SOU DESIGNER. Sou professor.'), '• Sou designer\n• Sou professor')
        summary = 'x' * (6000 - len('• Sou professor') - 1)
        self.assertEqual(len(learn(summary, 'Sou professor. Sou estudante.')), 6000)


if __name__ == '__main__':
    unittest.main()
