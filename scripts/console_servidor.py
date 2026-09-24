"""Console controls for restarting only the server launched by this process."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def stop_server(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def start_server(open_browser=False):
    options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {}
    command = [sys.executable, '-u', str(ROOT / 'run.py')]
    if open_browser:
        command.append('--open-browser')
    return subprocess.Popen(command,
                            cwd=ROOT, stdin=subprocess.DEVNULL, **options)


def main():
    process = None
    try:
        process = start_server(open_browser=True)
        print('\nComandos: R + Enter reinicia | S + Enter encerra.\n', flush=True)
        while True:
            command = input().strip().casefold()
            if command in ('s', 'sair'):
                break
            if command in ('r', 'reiniciar'):
                print('Reiniciando o servidor...', flush=True)
                stop_server(process)
                process = start_server()
                print('Comandos: R + Enter reinicia | S + Enter encerra.', flush=True)
            elif command:
                print('Use R para reiniciar ou S para sair, seguido de Enter.', flush=True)
    except (KeyboardInterrupt, EOFError):
        pass
    finally:
        stop_server(process)
    print('Servidor encerrado.', flush=True)


if __name__ == '__main__':
    main()
