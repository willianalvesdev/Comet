from contextlib import contextmanager

import mysql.connector
from flask import current_app, g


def options(config, database=True):
    connection_options = {
        'host': config['DB_HOST'],
        'port': config['DB_PORT'],
        'user': config['DB_USER'],
        'password': config['DB_PASSWORD'],
        'charset': 'utf8mb4',
        'collation': 'utf8mb4_unicode_ci',
        'connection_timeout': 5,
        'autocommit': False,
    }
    if database:
        connection_options['database'] = config['DB_NAME']
    return connection_options


def get_db():
    if 'db' not in g:
        g.db = mysql.connector.connect(**options(current_app.config))
    return g.db


def close_db(error=None):
    connection = g.pop('db', None)
    if connection is not None:
        connection.close()


@contextmanager
def managed_cursor(connection, write=False):
    database_cursor = None
    try:
        database_cursor = connection.cursor(dictionary=True, buffered=True)
        yield database_cursor
        if write:
            connection.commit()
    except BaseException:
        if write:
            connection.rollback()
        raise
    finally:
        if database_cursor is not None:
            database_cursor.close()


@contextmanager
def cursor(write=False):
    with managed_cursor(get_db(), write=write) as database_cursor:
        yield database_cursor
