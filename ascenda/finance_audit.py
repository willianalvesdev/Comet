import json
from datetime import date, datetime, timezone
from decimal import Decimal


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def audit_values(values):
    result = {}
    for key, value in values.items():
        if isinstance(value, Decimal):
            value = format(value, '.2f')
        elif isinstance(value, datetime):
            value = value.isoformat() + 'Z'
        elif isinstance(value, date):
            value = value.isoformat()
        result[key] = value
    return result


def record_event(cursor, user_id, operation_id, transaction_id, event, before, after, timestamp=None):
    cursor.execute(
        'INSERT INTO finance_transaction_events '
        '(usuario_id, operation_id, transaction_id, event, occurred_at, before_json, after_json) '
        'VALUES (%s,%s,%s,%s,%s,%s,%s)',
        (user_id, operation_id, transaction_id, event, timestamp or utc_now(),
         json.dumps(audit_values(before), ensure_ascii=False) if before is not None else None,
         json.dumps(audit_values(after), ensure_ascii=False) if after is not None else None))
