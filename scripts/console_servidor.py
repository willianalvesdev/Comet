import ctypes
from ctypes import wintypes
import os
import hashlib
import shutil
from pathlib import Path
import subprocess
import sys
import uuid

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


def acquire_instance():
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel.CloseHandle.restype = wintypes.BOOL
    name = 'Local\\Comet-' + str(uuid.uuid5(uuid.NAMESPACE_URL, str(ROOT).casefold()))
    handle = kernel.CreateMutexW(None, False, name)
    error = ctypes.get_last_error()
    if not handle:
        raise ctypes.WinError(error)
    if error == 183:
        kernel.CloseHandle(handle)
        return None
    return kernel, handle


def build_frontend():
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not shutil.which('node') or not npm:
        print('Instale Node.js com npm e abra novamente o iniciar.bat.', flush=True)
        return False
    try:
        digest = hashlib.sha256((ROOT / 'package-lock.json').read_bytes()).hexdigest()
        stamp = ROOT / 'node_modules' / '.ascenda-lock.sha256'
        if not stamp.exists() or stamp.read_text() != digest or not all((ROOT / path).is_file() for path in ('node_modules/typescript/bin/tsc', 'node_modules/next/dist/bin/next', 'node_modules/tailwindcss/package.json', 'node_modules/@tailwindcss/postcss/package.json', 'node_modules/react/package.json')):
            if subprocess.run([npm, 'ci', '--no-audit', '--no-fund'], cwd=ROOT).returncode:
                return False
            stamp.write_text(digest)
        if subprocess.run([npm, 'run', 'build'], cwd=ROOT).returncode:
            print('Build falhou. O servidor existente foi mantido.', flush=True)
            return False
        return True
    except OSError as error:
        print(f'Falha ao preparar o frontend: {error}', flush=True)
        return False


def main():
    process = None
    try:
        if not build_frontend():
            return 1
        process = start_server(open_browser=True)
        print('\nComandos: R + Enter reinicia | S + Enter encerra.\n', flush=True)
        while True:
            command = input().strip().casefold()
            if command in ('s', 'sair'):
                break
            if command in ('r', 'reiniciar'):
                if not build_frontend():
                    continue
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
    if os.name == 'nt':
        instance = acquire_instance()
        if instance is None:
            print('O Comet já está aberto. Use a janela existente para reiniciar ou encerrar.', flush=True)
        else:
            kernel, handle = instance
            try:
                sys.exit(main())
            finally:
                kernel.CloseHandle(handle)
    else:
        sys.exit(main())
