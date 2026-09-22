"""Cria apenas o banco e o usuário próprios do Ascenda, sem apagar registros."""
import getpass
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import mysql.connector
from ascenda import create_app, db


def main():
    app = create_app()
    config = app.config
    name, user = config['DB_NAME'], config['DB_USER']
    if not re.fullmatch(r'ascenda_[A-Za-z0-9_]{1,40}', name):
        raise SystemExit('DB_NAME deve começar com ascenda_. O banco do Rota Financeira não será usado.')
    if not re.fullmatch(r'ascenda_[A-Za-z0-9_]{1,24}', user):
        raise SystemExit('DB_USER deve começar com ascenda_. Use uma conta própria da aplicação.')
    if config['DB_HOST'] not in ('localhost', '127.0.0.1'):
        raise SystemExit('Este configurador é exclusivo para MySQL local.')
    if len(config['DB_PASSWORD']) < 16:
        raise SystemExit('Configure uma DB_PASSWORD com pelo menos 16 caracteres no .env.')
    print(f'Preparando banco {name} e usuário {user}. Nenhum dado existente será apagado.')
    admin = input('Usuário administrador do MySQL [root]: ').strip() or 'root'
    if admin == user:
        raise SystemExit('Use um administrador diferente da conta da aplicação.')
    password = getpass.getpass('Senha do administrador MySQL (não será salva): ')
    options = db.options(config, database=False)
    options.update(user=admin, password=password)
    try:
        with mysql.connector.connect(**options) as connection:
            with connection.cursor() as cur:
                cur.execute(f'CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
                cur.execute(f'USE `{name}`')
                for statement in (ROOT / 'setup_banco.sql').read_text(encoding='utf-8').split(';'):
                    if statement.strip():
                        cur.execute(statement)
                cur.execute("CREATE USER IF NOT EXISTS %s@'localhost' IDENTIFIED BY %s", (user, config['DB_PASSWORD']))
                cur.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON `{name}`.* TO %s@'localhost'", (user,))
            connection.commit()
        with mysql.connector.connect(**db.options(config)) as connection:
            with connection.cursor() as cur:
                cur.execute('SELECT id FROM usuarios LIMIT 0')
        print('Banco pronto. Agora execute iniciar.bat.')
    except mysql.connector.Error as error:
        print(f'Não foi possível configurar o MySQL (código {error.errno}).')
        print('Confira o serviço MySQL, a senha administrativa e os dados do .env. Nenhuma senha foi alterada.')
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
