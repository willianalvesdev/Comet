"""Adiciona apenas o horário opcional das transações ao banco local existente."""
import getpass
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import mysql.connector
from comet import create_app, db


def main():
    config = create_app().config
    if config['DB_HOST'] not in ('localhost', '127.0.0.1') or not config['DB_NAME'].startswith(('comet_', 'ascenda_')):
        raise SystemExit('Esta atualização é exclusiva para o banco local do Comet.')
    print('Esta atualização adiciona o campo de horário. Nenhuma transação será apagada ou alterada.')
    options = db.options(config)
    options.update(user=input('Usuário administrador MySQL [root]: ').strip() or 'root',
                   password=getpass.getpass('Senha do administrador MySQL (não será salva): '))
    try:
        with mysql.connector.connect(**options) as connection:
            with connection.cursor(buffered=True) as cursor:
                cursor.execute("SHOW COLUMNS FROM finance_transactions LIKE 'occurred_time'")
                if not cursor.fetchone():
                    cursor.execute('ALTER TABLE finance_transactions ADD COLUMN occurred_time TIME NULL DEFAULT NULL')
            connection.commit()
        print('Horários ativados. Atualize a página do Comet.')
    except mysql.connector.Error as error:
        print(f'Não foi possível atualizar o banco (código MySQL {error.errno}). Confira o acesso administrativo.')
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
