"""Servidor local do Ascenda, sem modo debug."""
import os

import mysql.connector
from waitress import serve

from ascenda import create_app, db

app = create_app()

if __name__ == '__main__':
    try:
        with app.app_context(), db.cursor() as cur:
            cur.execute('SELECT id FROM usuarios LIMIT 0')
            cur.execute('SELECT token_hash FROM sessoes LIMIT 0')
    except mysql.connector.Error:
        raise SystemExit('Banco indisponível. Execute configurar_banco.bat e confira se o MySQL está iniciado.')
    host = os.getenv('APP_HOST', '127.0.0.1')
    port = int(os.getenv('APP_PORT', '5001'))
    print(f'Ascenda disponível em http://{host}:{port}', flush=True)
    print('Mantenha esta janela aberta. Para encerrar, pressione Ctrl+C.', flush=True)
    serve(app, host=host, port=port, threads=4)
