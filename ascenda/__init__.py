"""Flask application and authentication for Ascenda."""
import os
import json
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps
from hashlib import sha256
from pathlib import Path

from dotenv import load_dotenv
from email_validator import EmailNotValidError, validate_email
from flask import Flask, Response, g, jsonify, redirect, render_template, request, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFError, CSRFProtect
from mysql.connector import Error as DatabaseError, IntegrityError
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from . import db

ROOT = Path(__file__).resolve().parent.parent


def normalize_email(value):
    if not isinstance(value, str) or len(value) > 254:
        raise ValueError('Informe um e-mail válido.')
    try:
        return validate_email(value.strip(), check_deliverability=False).normalized.casefold()
    except EmailNotValidError:
        raise ValueError('Informe um e-mail válido.') from None


def create_app(test_config=None):
    load_dotenv(ROOT / '.env')
    app = Flask(__name__, template_folder=str(ROOT), static_folder=str(ROOT / 'static'))
    app.config.from_mapping(
        SECRET_KEY=os.getenv('SECRET_KEY'),
        DB_HOST=os.getenv('DB_HOST', '127.0.0.1'), DB_PORT=int(os.getenv('DB_PORT', '3306')),
        DB_NAME=os.getenv('DB_NAME', 'ascenda_db'), DB_USER=os.getenv('DB_USER', 'ascenda_app'),
        DB_PASSWORD=os.getenv('DB_PASSWORD', ''),
        SESSION_COOKIE_NAME='ascenda_session', SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.getenv('SESSION_COOKIE_SECURE', 'false').lower() == 'true',
        SESSION_REFRESH_EACH_REQUEST=False, PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        MAX_CONTENT_LENGTH=64 * 1024, MAX_FORM_MEMORY_SIZE=16 * 1024,
        RATELIMIT_STORAGE_URI=os.getenv('RATELIMIT_STORAGE_URI', 'memory://'),
        RATELIMIT_HEADERS_ENABLED=True,
        NEWS_API_KEY=os.getenv('NEWS_API_KEY', ''),
    )
    if test_config:
        app.config.update(test_config)
    if (not app.config['SECRET_KEY'] or len(app.config['SECRET_KEY']) < 32
            or app.config['SECRET_KEY'].startswith('gere-')):
        raise RuntimeError('Execute iniciar.bat para preparar a configuração local.')
    # Only chat accepts a larger body; authentication forms retain their limits.
    @app.before_request
    def chat_request_limit():
        if request.path == '/api/ai/attachments':
            request.max_content_length = 9 * 1024 * 1024
            request.max_form_memory_size = 256 * 1024
        if request.path == '/api/ai/chat':
            request.max_content_length = 256 * 1024

    CSRFProtect(app)
    limiter = Limiter(key_func=get_remote_address, app=app)
    app.extensions['ascenda_limiter'] = limiter
    from .news import NewsService, NewsError, topic_selection
    news_service = NewsService(app.config['NEWS_API_KEY'])
    app.extensions['ascenda_news'] = news_service
    from .ai.config import AIConfig
    from .ai.remote import RemoteProvider
    from .ai.ollama import OllamaProvider
    from .ai.service import ComputerService
    from .ai.errors import AIError
    from .ai.conversations import ConversationStore
    ai_config = app.config.get('AI_CONFIG') or AIConfig.from_env()
    providers = {'qwen': OllamaProvider(ai_config), 'gemini': RemoteProvider.from_env('gemini', ai_config)}
    computer_service = ComputerService(providers['qwen'], ai_config, providers)
    app.extensions['ascenda_computer'] = computer_service
    conversation_store = ConversationStore(app.config)
    app.extensions['ascenda_conversations'] = conversation_store
    from .ai.attachments import AttachmentStore
    attachments = AttachmentStore(ROOT / 'instance' / 'attachments')
    conversation_store.attachments = attachments
    from .ai.personalization import PersonalizationStore
    personalization = PersonalizationStore(conversation_store)
    computer_service.personalization = personalization
    app.extensions['ascenda_personalization'] = personalization
    app.teardown_appcontext(db.close_db)
    dummy_hash = generate_password_hash(secrets.token_urlsafe(32))

    def current_user():
        if 'user' not in g:
            g.user = None
            token = session.get('auth_token')
            if isinstance(token, str):
                with db.cursor() as cur:
                    cur.execute('SELECT u.id, u.nome, u.email FROM usuarios u JOIN sessoes s '
                                'ON s.usuario_id=u.id WHERE s.token_hash=%s AND s.expira_em>UTC_TIMESTAMP()',
                                (sha256(token.encode()).hexdigest(),))
                    g.user = cur.fetchone()
            if not g.user and token:
                session.clear()
        return g.user

    def protected(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if not current_user():
                return redirect('/?login=1')
            return view(*args, **kwargs)
        return wrapper

    def issue_session(cur, user_id):
        old = session.get('auth_token')
        if old:
            cur.execute('DELETE FROM sessoes WHERE token_hash=%s', (sha256(old.encode()).hexdigest(),))
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc).replace(tzinfo=None) + app.permanent_session_lifetime
        cur.execute('DELETE FROM sessoes WHERE usuario_id=%s AND expira_em<=UTC_TIMESTAMP()', (user_id,))
        cur.execute('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (%s,%s,%s)',
                    (sha256(token.encode()).hexdigest(), user_id, expires))
        return token

    def save_session(token):
        session.clear()
        session.permanent = True
        session['auth_token'] = token

    @app.get('/')
    @app.get('/index.html')
    def landing():
        if current_user():
            return redirect('/principal.html')
        return render_template('index.html')

    @app.get('/principal.html')
    @protected
    def principal():
        return redirect('/computer.html?new=1' + ('&settings=personalization' if request.args.get('settings') == 'personalization' else ''))

    @app.get('/api/ai/models')
    def computer_models():
        if not current_user():
            return jsonify(error='Entre novamente para escolher um modelo.'), 401
        response = jsonify(models=[{'id': name, 'name': provider.label, 'configured': name == 'qwen' or bool(provider.key)}
                                   for name, provider in providers.items()])
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.post('/api/ai/attachments')
    @limiter.limit('20 per minute')
    def computer_attachment():
        user = current_user()
        if not user:
            return jsonify(error='Entre novamente para anexar arquivos.'), 401
        if set(request.files) != {'file'}:
            return jsonify(error='Selecione um arquivo.'), 422
        try:
            response = jsonify(attachments.upload(user['id'], request.files['file']))
            response.headers['Cache-Control'] = 'no-store'
            return response
        except AIError as exc:
            return jsonify(error=exc.message), exc.status

    @app.post('/api/ai/chat')
    @limiter.limit('10 per minute')
    def computer_chat():
        user = current_user()
        if not user:
            return jsonify(error='Entre novamente para conversar com a Computer.', code='unauthorized'), 401
        # Do not hold a database connection during generation.
        db.close_db()
        try:
            payload = conversation_store.validate(request.get_json(silent=True))
            source = computer_service.stream_saved(user['id'], payload, conversation_store)
            first = next(source)
        except AIError as exc:
            app.logger.warning('Computer request failed (%s)', exc.code)
            return jsonify(error=exc.message, code=exc.code), exc.status

        def encode(event):
            return json.dumps(event, ensure_ascii=False) + '\n'

        def generate():
            try:
                yield encode(first)
                for event in source:
                    yield encode(event)
            except AIError as exc:
                app.logger.warning('Computer stream failed (%s)', exc.code)
                yield encode({'type': 'error', 'error': exc.message, 'code': exc.code})
            except Exception:
                app.logger.exception('Unexpected Computer stream failure')
                yield encode({'type': 'error', 'error': 'A resposta foi interrompida. Tente novamente.'})
            finally:
                source.close()

        response = Response(generate(), content_type='application/x-ndjson; charset=utf-8')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Accel-Buffering'] = 'no'
        response.call_on_close(source.close)
        return response

    @app.get('/api/ai/conversations')
    def computer_conversations():
        user = current_user()
        if not user:
            return jsonify(error='Entre novamente para acessar suas conversas.'), 401
        try:
            offset = int(request.args.get('offset', '0'))
            if not 0 <= offset <= 1000000:
                raise ValueError
            return jsonify(conversation_store.list(user['id'], offset, request.args.get('q', '')))
        except ValueError:
            return jsonify(error='Página inválida.'), 422
        except AIError as exc:
            return jsonify(error=exc.message, code=exc.code), exc.status

    @app.get('/api/ai/conversations/<cid>/preview')
    def computer_conversation_preview(cid):
        user = current_user()
        if not user:
            return jsonify(error='Entre novamente para acessar suas conversas.'), 401
        try:
            response = jsonify(conversation_store.preview(user['id'], cid))
            response.headers['Cache-Control'] = 'no-store'
            return response
        except AIError as exc:
            return jsonify(error=exc.message, code=exc.code), exc.status

    @app.get('/api/ai/conversations/<cid>')
    def computer_conversation(cid):
        user = current_user()
        if not user:
            return jsonify(error='Entre novamente para acessar suas conversas.'), 401
        try:
            return jsonify(conversation_store.get(user['id'], cid, request.args.get('before')))
        except AIError as exc:
            return jsonify(error=exc.message, code=exc.code), exc.status

    @app.route('/api/ai/conversations/<cid>', methods=['PATCH', 'DELETE'])
    @limiter.limit('30 per minute')
    def change_computer_conversation(cid):
        user = current_user()
        if not user:
            return jsonify(error='Entre novamente para acessar suas conversas.'), 401
        try:
            title = None
            if request.method == 'PATCH':
                payload = request.get_json(silent=True)
                if not isinstance(payload, dict) or set(payload) != {'title'}:
                    raise AIError('invalid_title', 422)
                title = payload['title']
            return jsonify(conversation_store.change(user['id'], cid, title, request.method == 'DELETE'))
        except AIError as exc:
            return jsonify(error=exc.message, code=exc.code), exc.status

    @app.post('/api/ai/conversations/<cid>/messages/<tid>/edit')
    @limiter.limit('10 per minute')
    def edit_computer_message(cid, tid):
        user = current_user()
        if not user:
            return jsonify(error='Entre novamente para editar suas mensagens.'), 401
        try:
            return jsonify(conversation_store.truncate_from(user['id'], cid, tid))
        except AIError as exc:
            return jsonify(error=exc.message, code=exc.code), exc.status

    @app.get('/personalizar.html')
    @protected
    def personalizar():
        return redirect('/principal.html?settings=personalization')

    @app.route('/api/ai/personalization', methods=['GET', 'PUT'])
    @limiter.limit('30 per minute')
    def computer_personalization():
        user = current_user()
        if not user:
            return jsonify(error='Entre novamente para personalizar o Computer.'), 401
        try:
            data = personalization.get(user['id']) if request.method == 'GET' else personalization.update(user['id'], request.get_json(silent=True))
            response = jsonify(data)
            response.headers['Cache-Control'] = 'no-store'
            return response
        except AIError as exc:
            return jsonify(error=exc.message), exc.status
        except DatabaseError:
            return jsonify(error='A personalização precisa da atualização do banco. Execute configurar_banco.bat e recarregue esta página.'), 503

    @app.get('/computer.html')
    @protected
    def computer():
        return render_template('computer.html', user=g.user)

    @app.get('/graficos.html')
    @protected
    def graficos():
        return render_template('graficos.html', user=g.user)

    @app.get('/robots.txt')
    def robots():
        from flask import send_from_directory
        return send_from_directory(ROOT, 'robots.txt', mimetype='text/plain')

    @app.get('/llms.txt')
    def llms():
        from flask import send_from_directory
        return send_from_directory(ROOT, 'llms.txt', mimetype='text/plain')

    @app.get('/manifest.webmanifest')
    def manifest():
        from flask import send_from_directory
        return send_from_directory(ROOT, 'manifest.webmanifest')

    @app.get('/descobrir.html')
    @protected
    def descobrir():
        return render_template('descobrir.html', user=g.user)

    @app.get('/api/news')
    @limiter.limit('30 per minute')
    def discovery_news():
        if not current_user():
            return jsonify(error='Entre novamente para ver as notícias.', code='unauthorized'), 401
        try:
            languages = request.args.get('languages', 'pt-en')
            if languages not in ('pt-en', 'all'):
                raise ValueError
            topics = topic_selection(request.args.get('topics', ''))
            mode = request.args.get('mode', 'for-you')
            if mode not in ('for-you', 'top'):
                raise ValueError
            page = int(request.args.get('page', '1'))
            if not 1 <= page <= 10:
                raise ValueError
        except ValueError:
            return jsonify(error='Página ou tópico inválido.'), 400
        try:
            return jsonify(news_service.get(page, topics, mode, languages))
        except NewsError as exc:
            return jsonify(error=exc.message, code=exc.code), 503

    @app.post('/api/auth/signup')
    @limiter.limit('5 per minute')
    def signup():
        name = request.form.get('name', '').strip()
        password = request.form.get('password', '')
        if not 2 <= len(name) <= 100 or any(ord(char) < 32 for char in name):
            return jsonify(error='O nome deve ter entre 2 e 100 caracteres.'), 422
        try:
            email = normalize_email(request.form.get('email', ''))
        except ValueError as exc:
            return jsonify(error=str(exc)), 422
        if not 8 <= len(password) <= 128 or not password.strip():
            return jsonify(error='A senha deve ter entre 8 e 128 caracteres.'), 422
        if password != request.form.get('confirmation'):
            return jsonify(error='As senhas não coincidem.'), 422
        password_hash = generate_password_hash(password)
        try:
            with db.cursor(write=True) as cur:
                cur.execute('INSERT INTO usuarios (nome, email, senha) VALUES (%s,%s,%s)',
                            (name, email, password_hash))
                token = issue_session(cur, cur.lastrowid)
        except IntegrityError as exc:
            if exc.errno != 1062:
                raise
            return jsonify(error='Este e-mail já está cadastrado. Entre com sua conta.'), 409
        save_session(token)
        return jsonify(ok=True), 201

    @app.post('/api/auth/login')
    @limiter.limit('10 per minute')
    def login():
        password = request.form.get('password', '')
        user = None
        try:
            email = normalize_email(request.form.get('email', ''))
            if len(password) > 128:
                raise ValueError
            with db.cursor() as cur:
                cur.execute('SELECT id, senha FROM usuarios WHERE email=%s', (email,))
                user = cur.fetchone()
            valid = check_password_hash(user['senha'] if user else dummy_hash, password)
        except (ValueError, TypeError):
            valid = False
        if not user or not valid:
            return jsonify(error='E-mail ou senha incorretos.'), 401
        with db.cursor(write=True) as cur:
            token = issue_session(cur, user['id'])
        save_session(token)
        return jsonify(ok=True)

    @app.post('/logout')
    def logout():
        token = session.get('auth_token')
        if token:
            with db.cursor(write=True) as cur:
                cur.execute('DELETE FROM sessoes WHERE token_hash=%s', (sha256(token.encode()).hexdigest(),))
        session.clear()
        return redirect('/')

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN' if request.endpoint == 'descobrir' else 'DENY'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        # Keep the microphone available for the dictation feature.
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(self), geolocation=(self)'
        if response.mimetype in ('text/html', 'application/json'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(CSRFError)
    def csrf_error(error):
        return jsonify(error='O formulário expirou. Atualize a página e tente novamente.'), 400

    @app.errorhandler(DatabaseError)
    def database_error(error):
        app.logger.error('Falha na conexão/operação MySQL (código %s)', error.errno)
        return jsonify(error='Não foi possível acessar sua conta agora. Tente novamente em instantes.'), 503

    @app.errorhandler(HTTPException)
    def http_error(error):
        response = error.get_response()
        response.data = app.json.dumps({'error': 'Muitas tentativas. Aguarde um minuto e tente novamente.'
                                      if error.code == 429 else 'Não foi possível atender esta solicitação.'})
        response.content_type = 'application/json'
        return response

    return app
