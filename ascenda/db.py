"""MySQL connections and schema, isolated from Rota Financeira."""
from contextlib import contextmanager

import mysql.connector
from flask import current_app, g


def options(config, database=True):
    result = dict(host=config['DB_HOST'], port=config['DB_PORT'],
                  user=config['DB_USER'], password=config['DB_PASSWORD'],
                  charset='utf8mb4', collation='utf8mb4_unicode_ci',
                  connection_timeout=5, autocommit=False)
    if database:
        result['database'] = config['DB_NAME']
    return result


def get_db():
    if 'db' not in g:
        g.db = mysql.connector.connect(**options(current_app.config))
    return g.db


def close_db(error=None):
    connection = g.pop('db', None)
    if connection is not None:
        connection.close()


@contextmanager
def cursor(write=False):
    connection = get_db()
    cur = connection.cursor(dictionary=True, buffered=True)
    try:
        yield cur
        if write:
            connection.commit()
    except Exception:
        if write:
            connection.rollback()
        raise
    finally:
        cur.close()
