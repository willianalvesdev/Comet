import os
import sys
import threading
import webbrowser
from datetime import datetime, timezone

import mysql.connector
from waitress import create_server

from ascenda import create_app, db

app = create_app()

if __name__ == '__main__':
    started_at = datetime.now(timezone.utc).replace(tzinfo=None)
    try:
        with app.app_context(), db.cursor() as cur:
            cur.execute('SELECT id FROM usuarios LIMIT 0')
            cur.execute('SELECT token_hash FROM sessoes LIMIT 0')
            cur.execute('SELECT id FROM computer_conversas LIMIT 0')
            cur.execute('SELECT id FROM computer_mensagens LIMIT 0')
    except mysql.connector.Error:
        raise SystemExit('Banco indisponível. Execute configurar_banco.bat e confira se o MySQL está iniciado.')
    host = os.getenv('APP_HOST', '127.0.0.1')
    port = int(os.getenv('APP_PORT', '5001'))
    server = create_server(app, host=host, port=port, threads=16)

    try:
        app.extensions['ascenda_conversations'].recover_interrupted(started_at)
    except Exception:
        server.close()
        raise
    print(f'Ascenda disponível em http://{host}:{port}', flush=True)
    print('Mantenha esta janela aberta. Para encerrar, pressione Ctrl+C.', flush=True)
    if '--open-browser' in sys.argv:
        browser_host = '127.0.0.1' if host in ('0.0.0.0', '::') else host
        if ':' in browser_host and not browser_host.startswith('['):
            browser_host = '[' + browser_host + ']'
        url = f'http://{browser_host}:{port}'
        def open_browser():
            try:
                if not webbrowser.open(url):
                    print(f'Abra o site pelo endereço: {url}', flush=True)
            except Exception:
                print(f'Abra o site pelo endereço: {url}', flush=True)
        threading.Thread(target=open_browser, daemon=True).start()
    try:
        server.run()
    finally:
        server.close()
