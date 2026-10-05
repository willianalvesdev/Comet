import getpass
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import mysql.connector
from comet import create_app, db


def main():
    app = create_app()
    config = app.config
    name, user = config['DB_NAME'], config['DB_USER']
    if not re.fullmatch(r'(?:comet|ascenda)_[A-Za-z0-9_]{1,40}', name):
        raise SystemExit('DB_NAME deve começar com comet_. O banco do Rota Financeira não será usado.')
    if not re.fullmatch(r'(?:comet|ascenda)_[A-Za-z0-9_]{1,24}', user):
        raise SystemExit('DB_USER deve começar com comet_. Use uma conta própria da aplicação.')
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
    stage = 'conectar como administrador'
    try:
        with mysql.connector.connect(**options) as connection:
            stage = 'criar as tabelas do Comet'
            with connection.cursor(buffered=True) as cur:
                cur.execute(f'CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
                cur.execute(f'USE `{name}`')
                for statement in (ROOT / 'setup_banco.sql').read_text(encoding='utf-8').split(';'):
                    if statement.strip():
                        cur.execute(statement)
                cur.execute("SHOW COLUMNS FROM finance_transactions LIKE 'deleted_at'")
                if not cur.fetchone():
                    cur.execute('ALTER TABLE finance_transactions ADD COLUMN deleted_at DATETIME(6) NULL DEFAULT NULL')
                cur.execute("CREATE USER IF NOT EXISTS %s@'localhost' IDENTIFIED BY %s", (user, config['DB_PASSWORD']))
                cur.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON `{name}`.* TO %s@'localhost'", (user,))
            connection.commit()
        stage = 'conferir a conexão do site'
        with mysql.connector.connect(**db.options(config)) as connection:
            with connection.cursor(buffered=True) as cur:
                cur.execute('SELECT id FROM usuarios LIMIT 0')
        print('Banco pronto. Agora execute iniciar.bat.')
    except mysql.connector.Error as error:
        detail = str(error.msg or type(error).__name__)
        for secret in (password, config['DB_PASSWORD']):
            if secret:
                detail = detail.replace(secret, '[senha ocultada]')
        print(f'Não foi possível configurar o MySQL ao {stage} (código {error.errno}).')
        print(f'Detalhe: {detail}')
        if error.errno == 1045:
            print('O MySQL recusou o usuário ou a senha. Use o administrador do MySQL, não a senha do Windows ou do site.')
        print('Nenhuma senha foi alterada. Os dados existentes foram preservados.')
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
