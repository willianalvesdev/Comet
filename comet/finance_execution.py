import hashlib
import json
import re
from uuid import UUID

from . import db
from .finance import transaction_time, validate_transaction
from .finance_audit import record_event, utc_now


class FinancialConflict(ValueError):
    pass


def validate_actions(payload):
    if not isinstance(payload, dict) or set(payload) != {'operation_id', 'actions'}:
        raise ValueError('Envie operation_id e actions.')
    try:
        operation_id = str(UUID(payload['operation_id']))
    except (ValueError, TypeError, AttributeError):
        raise ValueError('Identificador da operação inválido.') from None
    actions = payload['actions']
    if not isinstance(actions, list) or not 1 <= len(actions) <= 100:
        raise ValueError('Envie de 1 a 100 ações.')
    bulk_lifecycle = len(actions) == 1 and isinstance(actions[0], dict) and actions[0].get('type') in ('delete', 'restore')
    seen = set()
    for action in actions:
        if not isinstance(action, dict):
            raise ValueError('Ação inválida.')
        kind = action.get('type')
        if kind == 'create':
            if set(action) != {'type', 'transaction'} or not isinstance(action['transaction'], dict) or 'external_id' in action['transaction']:
                raise ValueError('Criação inválida.')
            validate_transaction({**action['transaction'], 'external_id': operation_id})
            continue
        if kind not in ('update', 'delete', 'restore', 'permanent_delete'):
            raise ValueError('Operação inválida.')
        fields = {'type', 'transaction_ids'} | ({'changes'} if kind == 'update' else {'confirmation'} if kind == 'permanent_delete' else set())
        if set(action) != fields:
            raise ValueError('Campos da ação inválidos.')
        if kind == 'permanent_delete' and action['confirmation'] != 'explicit_permanent_delete':
            raise ValueError('A exclusão permanente exige um pedido explícito.')
        ids = action['transaction_ids']
        if not isinstance(ids, list) or not ids or (not bulk_lifecycle and len(ids) > 100) or any(not isinstance(i, str) or not re.fullmatch(r'[1-9][0-9]{0,19}', i) or int(i) > 18446744073709551615 for i in ids):
            raise ValueError('IDs de transações inválidos.')
        if len(set(ids)) != len(ids) or seen.intersection(ids):
            raise ValueError('Uma transação não pode aparecer duas vezes no mesmo pedido.')
        seen.update(ids)
        if kind == 'update':
            changes = action['changes']
            if not isinstance(changes, dict) or not changes or set(changes) - {'kind', 'amount', 'description', 'category', 'occurred_on', 'occurred_time'}:
                raise ValueError('Alterações inválidas.')
    if not bulk_lifecycle and len(seen) > 100:
        raise ValueError('Limite de 100 transações por pedido.')
    return operation_id, actions


def execute_financial_actions(user_id, payload):
    operation_id, actions = validate_actions(payload)
    digest = hashlib.sha256(json.dumps(actions, sort_keys=True, ensure_ascii=True).encode()).hexdigest()
    with db.cursor(write=True) as cursor:
        cursor.execute('INSERT INTO finance_operations (usuario_id, operation_id, request_hash) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE operation_id=VALUES(operation_id)', (user_id, operation_id, digest))
        cursor.execute('SELECT request_hash, result FROM finance_operations WHERE usuario_id=%s AND operation_id=%s FOR UPDATE', (user_id, operation_id))
        previous = cursor.fetchone()
        if previous['request_hash'] != digest:
            raise FinancialConflict('Este pedido já foi utilizado com outras ações.')
        if previous['result'] is not None:
            return json.loads(previous['result'])
        targets, updates = {}, {}
        target_actions = {identifier: action for action in actions if action['type'] != 'create'
                          for identifier in action['transaction_ids']}
        # Validate and lock the whole batch before changing any financial records.
        for identifier in sorted(target_actions, key=int):
            action = target_actions[identifier]
            kind = action['type']
            cursor.execute('SELECT * FROM finance_transactions WHERE usuario_id=%s AND id=%s FOR UPDATE', (user_id, identifier))
            row = cursor.fetchone()
            if row is None:
                raise FinancialConflict('A transação não está mais disponível nesta conta. Atualize os dados.')
            row['occurred_time'] = transaction_time(row)
            deleted = row['deleted_at'] is not None
            if kind in ('update', 'delete') and deleted:
                raise FinancialConflict('Esta transação está na lixeira. Restaure antes de alterá-la.')
            if kind in ('restore', 'permanent_delete') and not deleted:
                raise FinancialConflict('Esta transação não está na lixeira.')
            targets[identifier] = row
            if kind == 'update':
                current = {**row, 'amount': format(row['amount'], '.2f'), 'occurred_on': row['occurred_on'].isoformat()}
                updates[identifier] = validate_transaction({**{key: current[key] for key in ('external_id', 'kind', 'amount', 'description', 'category', 'occurred_on', 'occurred_time')}, **action['changes']}, default_time=False)
        operations = []
        for index, action in enumerate(actions):
            kind = action['type']
            ids = []
            if kind == 'create':
                values = validate_transaction({**action['transaction'], 'external_id': f'{operation_id}:{index}'})
                cursor.execute('INSERT INTO finance_transactions (usuario_id, external_id, kind, amount, description, category, occurred_on, occurred_time) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
                               (user_id, *(values[field] for field in ('external_id', 'kind', 'amount', 'description', 'category', 'occurred_on', 'occurred_time'))))
                identifier = str(cursor.lastrowid)
                record_event(cursor, user_id, operation_id, identifier, 'TRANSACTION_CREATED', None,
                             {key: value for key, value in values.items() if key != 'external_id'})
                ids.append(identifier)
            else:
                for identifier in sorted(action['transaction_ids'], key=int):
                    row = targets[identifier]
                    timestamp = utc_now()
                    before, after = None, None
                    if kind == 'update':
                        values = updates[identifier]
                        cursor.execute('UPDATE finance_transactions SET kind=%s, amount=%s, description=%s, category=%s, occurred_on=%s, occurred_time=%s WHERE usuario_id=%s AND id=%s',
                                       (*(values[field] for field in ('kind', 'amount', 'description', 'category', 'occurred_on', 'occurred_time')), user_id, identifier))
                        changed = [key for key in values if key != 'external_id' and row[key] != values[key]]
                        before = {key: row[key] for key in changed}
                        after = {key: values[key] for key in changed}
                    elif kind == 'delete':
                        cursor.execute('UPDATE finance_transactions SET deleted_at=%s WHERE usuario_id=%s AND id=%s', (timestamp, user_id, identifier))
                        before, after = {'deleted_at': None}, {'deleted_at': timestamp}
                    elif kind == 'restore':
                        cursor.execute('UPDATE finance_transactions SET deleted_at=NULL WHERE usuario_id=%s AND id=%s', (user_id, identifier))
                        before, after = {'deleted_at': row['deleted_at']}, {'deleted_at': None}
                    else:
                        cursor.execute('DELETE FROM finance_transactions WHERE usuario_id=%s AND id=%s AND deleted_at IS NOT NULL', (user_id, identifier))
                    event = {'update': 'TRANSACTION_UPDATED', 'delete': 'TRANSACTION_DELETED',
                             'restore': 'TRANSACTION_RESTORED', 'permanent_delete': 'TRANSACTION_PERMANENTLY_DELETED'}[kind]
                    record_event(cursor, user_id, operation_id, identifier, event, before, after, timestamp)
                    ids.append(identifier)
            operations.append({'type': kind, 'transaction_ids': ids})
        result = {'operation_id': operation_id, 'operations': operations}
        cursor.execute('UPDATE finance_operations SET result=%s WHERE usuario_id=%s AND operation_id=%s', (json.dumps(result), user_id, operation_id))
        return result
