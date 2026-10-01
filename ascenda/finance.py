from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import re

from mysql.connector import IntegrityError

from . import db


def today_local():
    return datetime.now(timezone(timedelta(hours=-3))).date()


def validate_transaction(payload):
    fields = {'external_id', 'kind', 'amount', 'description', 'category', 'occurred_on'}
    if not isinstance(payload, dict) or set(payload) - fields:
        raise ValueError('Envie apenas os campos da transação.')
    result = {}
    for field, limit in [('external_id', 100), ('description', 200), ('category', 80)]:
        value = payload.get(field, '' if field == 'category' else None)
        if not isinstance(value, str) or len(value.strip()) > limit or (field != 'category' and not value.strip()):
            raise ValueError('Campo inválido: ' + field)
        result[field] = value.strip()
    if payload.get('kind') not in ('income', 'expense'):
        raise ValueError('kind deve ser income ou expense.')
    result['kind'] = payload['kind']
    value = payload.get('amount')
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,12}(?:\.[0-9]{1,2})?', value):
        raise ValueError('amount deve ser uma string decimal, como 1250.50.')
    try:
        amount = Decimal(value)
        if not amount.is_finite() or not Decimal('0') < amount <= Decimal('999999999999.99') or amount != amount.quantize(Decimal('.01')):
            raise ValueError('Valor monetário inválido.')
    except InvalidOperation:
        raise ValueError('Valor monetário inválido.') from None
    result['amount'] = amount.quantize(Decimal('.01'))
    try:
        raw_date = payload.get('occurred_on', '')
        if not isinstance(raw_date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw_date):
            raise ValueError()
        occurred_on = date.fromisoformat(raw_date)
    except (TypeError, ValueError):
        raise ValueError('occurred_on deve usar AAAA-MM-DD.') from None
    if not date(1970, 1, 1) <= occurred_on <= today_local():
        raise ValueError('Informe uma data passada ou atual, a partir de 1970.')
    result['occurred_on'] = occurred_on
    return result


def transaction_title(description):
    title = re.sub(r'\s+', ' ', description.strip()).rstrip('.!')
    title = re.sub(r'\s+(?:hoje|ontem|anteontem)$', '', title, flags=re.I)
    match = re.match(r'^(?:eu )?(gastei|paguei|comprei|recebi|ganhei)\s+(?:r\$\s*)?[0-9.,]+\s*(?:reais|real)?(?:\s+(?:no|na|nos|nas|em|com|de|do|da|por)\s+(.+))?$', title, re.I)
    if match:
        title = match[2] or match[1]
    words = title.split()
    connectors = {'de', 'do', 'da', 'dos', 'das', 'e', 'no', 'na', 'para', 'com'}
    return ' '.join(word.lower() if index and word.lower() in connectors else word if any(letter.isupper() for letter in word[1:]) else word[:1].upper() + word[1:] for index, word in enumerate(words))


def serialize(row):
    return {**{field: row[field] for field in ('external_id', 'kind', 'description', 'category')},
            'description': transaction_title(row['description']), 'id': str(row['id']), 'amount': format(row['amount'], '.2f'), 'currency': 'BRL',
            'occurred_on': row['occurred_on'].isoformat()}


def receive(user_id, payload):
    values = validate_transaction(payload)
    try:
        with db.cursor(write=True) as cursor:
            cursor.execute('INSERT INTO finance_transactions (usuario_id, external_id, kind, amount, description, category, occurred_on) VALUES (%s,%s,%s,%s,%s,%s,%s)',
                           (user_id, *(values[field] for field in ('external_id', 'kind', 'amount', 'description', 'category', 'occurred_on'))))
            identifier = cursor.lastrowid
        return serialize({'id': identifier, **values}), True
    except IntegrityError as error:
        if error.errno != 1062:
            raise
        with db.cursor() as cursor:
            cursor.execute('SELECT * FROM finance_transactions WHERE usuario_id=%s AND external_id=%s', (user_id, values['external_id']))
            existing = cursor.fetchone()
        if not existing or any(existing[field] != value for field, value in values.items()):
            return None, False
        return serialize(existing), False


def history(user_id, limit=30, before=None):
    if not 1 <= limit <= 100:
        raise ValueError('limit deve estar entre 1 e 100.')
    condition, parameters = '', [user_id]
    if before:
        try:
            day, identifier = before.split(':')
            day, identifier = date.fromisoformat(day), int(identifier)
            if not 0 < identifier <= 18446744073709551615:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError('Cursor inválido.') from None
        condition = ' AND (occurred_on < %s OR (occurred_on=%s AND id < %s))'
        parameters.extend([day, day, identifier])
    with db.cursor() as cursor:
        cursor.execute('SELECT * FROM finance_transactions WHERE usuario_id=%s' + condition + ' ORDER BY occurred_on DESC, id DESC LIMIT %s', (*parameters, limit + 1))
        rows = cursor.fetchall()
    page = rows[:limit]
    next_cursor = f"{page[-1]['occurred_on'].isoformat()}:{page[-1]['id']}" if len(rows) > limit else None
    return {'transactions': [serialize(row) for row in page], 'next_cursor': next_cursor}


def summarize(rows, today=None):
    today = today or today_local()
    month_start = today.replace(day=1)
    previous_end = month_start - timedelta(days=1)
    previous_start = previous_end.replace(day=1)
    current = {'income': Decimal(0), 'expense': Decimal(0)}
    previous = current.copy()
    balance = Decimal(0)
    previous_balance = Decimal(0)
    daily = {}
    for row in rows:
        day, amount = row['occurred_on'], row['amount']
        if day > today:
            continue
        point = daily.setdefault(day, {'open': balance, 'high': balance, 'low': balance, 'close': balance, 'volume': Decimal(0), 'income': Decimal(0), 'expense': Decimal(0)})
        balance += amount if row['kind'] == 'income' else -amount
        point.update(high=max(point['high'], balance), low=min(point['low'], balance), close=balance, volume=point['volume'] + amount)
        point[row['kind']] += amount
        if day < month_start:
            previous_balance = balance
        if day >= month_start:
            current[row['kind']] += amount
        elif day >= previous_start:
            previous[row['kind']] += amount
    points, sparks = [], {'balance': [], 'income': [], 'expense': []}
    income, expense, carried = Decimal(0), Decimal(0), Decimal(0)
    day = min(min(daily), month_start) if daily else month_start
    while day <= today:
        point = daily.get(day, {'open': carried, 'high': carried, 'low': carried, 'close': carried, 'volume': Decimal(0), 'income': Decimal(0), 'expense': Decimal(0)})
        carried = point['close']
        if daily:
            points.append({'time': int(datetime.combine(day, datetime.min.time(), timezone.utc).timestamp()), **{key: float(point[key]) for key in ('open', 'high', 'low', 'close', 'volume')}})
        if day >= month_start:
            income += point['income']
            expense += point['expense']
            for key, value in [('balance', carried), ('income', income), ('expense', expense)]:
                sparks[key].append(float(value))
        day += timedelta(days=1)
    def card(value, old, key):
        difference = value - old
        return {'amount': format(value, '.2f'), 'difference': format(difference, '.2f'),
                'percentage': format(difference / abs(old) * 100, '.2f') if old else None, 'series': sparks[key]}
    return {'currency': 'BRL', 'as_of': today.isoformat(), 'month': today.strftime('%Y-%m'),
            'summary': {'balance': card(balance, previous_balance, 'balance'), 'income': card(current['income'], previous['income'], 'income'), 'expense': card(current['expense'], previous['expense'], 'expense')},
            'chart': {'currency': 'BRL', 'kind': 'balance', 'points': points, 'intraday': []}}


def dashboard(user_id):
    with db.cursor() as cursor:
        cursor.execute('SELECT id, kind, amount, occurred_on FROM finance_transactions WHERE usuario_id=%s AND occurred_on<=%s ORDER BY occurred_on, id', (user_id, today_local()))
        rows = cursor.fetchall()
    return summarize(rows)
