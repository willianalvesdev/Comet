"""Prepara um ambiente próprio e configuração local; não reutiliza dados do outro site."""
import hashlib
from pathlib import Path
import secrets
import subprocess
import venv

ROOT = Path(__file__).resolve().parent.parent


def main():
    executable = ROOT / 'venv' / 'Scripts' / 'python.exe'
    if not executable.exists():
        print('Preparando ambiente Python...', flush=True)
        venv.EnvBuilder(with_pip=True).create(ROOT / 'venv')
    requirements = ROOT / 'requirements.txt'
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    marker = ROOT / 'venv' / '.requirements.sha256'
    if not marker.exists() or marker.read_text() != digest:
        subprocess.run([str(executable), '-m', 'pip', 'install', '-r', str(requirements)], check=True)
        marker.write_text(digest)
    env = ROOT / '.env'
    if not env.exists():
        with env.open('x', encoding='utf-8') as output:
            output.write(
                f'SECRET_KEY={secrets.token_urlsafe(48)}\n'
                'DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=ascenda_db\nDB_USER=ascenda_app\n'
                f'DB_PASSWORD={secrets.token_urlsafe(32)}\n'
                'APP_HOST=127.0.0.1\nAPP_PORT=5001\nSESSION_COOKIE_SECURE=false\n'
                'RATELIMIT_STORAGE_URI=memory://\n'
            )
    print('Ambiente pronto.', flush=True)


if __name__ == '__main__':
    main()
