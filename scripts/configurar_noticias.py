"""Store the Marketaux key locally, never in frontend assets or Git."""
from getpass import getpass
from pathlib import Path

from dotenv import set_key

ROOT = Path(__file__).resolve().parent.parent

if __name__ == '__main__':
    print('Obtenha sua chave no painel de https://www.marketaux.com/')
    token = getpass('Chave Marketaux (a digitação fica invisível; Enter cancela): ').strip()
    if token:
        if len(token) > 512 or any(c.isspace() or ord(c) < 32 for c in token):
            raise SystemExit('Chave inválida. Copie somente o token do painel.')
        set_key(str(ROOT / '.env'), 'MARKETAUX_API_TOKEN', token)
        print('Chave salva. Reinicie o iniciar.bat para carregar as notícias.')
    else:
        print('Nenhuma alteração realizada.')
