import base64
import json
import os
import secrets
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from functools import wraps
from hashlib import sha256
from pathlib import Path

from dotenv import load_dotenv
from email_validator import EmailNotValidError, validate_email
from flask import Flask, Response, g, jsonify, redirect, request, send_from_directory, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFError, CSRFProtect, generate_csrf
from jinja2.utils import htmlsafe_json_dumps
from markupsafe import escape
from mysql.connector import Error as DatabaseError, IntegrityError
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from . import db

ROOT = Path(__file__).resolve().parent.parent


APP_PAGES = ('index', 'computer', 'recentes', 'descobrir', 'aprender', 'graficos')


def next_page_html(export_dir, page, bootstrap):
    if page not in APP_PAGES:
        raise ValueError('Página inválida.')
    filename = 'index.html' if page == 'index' else f'{page}.html.html'
    try:
        html = (Path(export_dir) / filename).read_text(encoding='utf-8')
    except OSError as error:
        raise RuntimeError('Frontend indisponível. Execute npm run build ou iniciar.bat.') from error
    if '</head>' not in html:
        raise RuntimeError('Exportação Next.js inválida. Execute npm run build.')
    state = htmlsafe_json_dumps(bootstrap)
    token = escape(bootstrap['csrfToken'])
    payload = f'<meta name="csrf-token" content="{token}"/><script id="app-bootstrap" type="application/json">{state}</script>'
    return html.replace('</head>', payload + '</head>', 1)


def normalize_email(value):
    if not isinstance(value, str) or len(value) > 254:
        raise ValueError('Informe um e-mail válido.')
    try:
        return validate_email(value.strip(), check_deliverability=False).normalized.casefold()
    except EmailNotValidError:
        raise ValueError('Informe um e-mail válido.') from None


def create_app(test_config=None):
    load_dotenv(ROOT / '.env')
    app = Flask(__name__, template_folder=None, static_folder=str(ROOT / 'static'))
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
        NEXT_EXPORT_DIR=ROOT / 'out',
    )
    if test_config:
        app.config.update(test_config)
    if (not app.config['SECRET_KEY'] or len(app.config['SECRET_KEY']) < 32
            or app.config['SECRET_KEY'].startswith('gere-')):
        raise RuntimeError('Execute iniciar.bat para preparar a configuração local.')
    @app.before_request
    def chat_request_limit():
        if request.path == '/api/ai/attachments':
            request.max_content_length = 9 * 1024 * 1024
            request.max_form_memory_size = 256 * 1024
        if request.path == '/api/ai/chat':
            request.max_content_length = 256 * 1024

    CSRFProtect(app)
    limiter = Limiter(key_func=get_remote_address, app=app)
    app.extensions['comet_limiter'] = limiter
    from .news import NewsService, NewsError, topic_selection
    news_service = NewsService(app.config['NEWS_API_KEY'])
    app.extensions['comet_news'] = news_service
    from .ai.config import AIConfig
    from .ai.remote import RemoteProvider
    from .ai.ollama import OllamaProvider
    from .ai.service import ComputerService
    from .ai.errors import AIError
    from .ai.conversations import ConversationStore
    ai_config = app.config.get('AI_CONFIG') or AIConfig.from_env()
    providers = {'qwen': OllamaProvider(ai_config), 'gemini': RemoteProvider.from_env('gemini', ai_config)}
    computer_service = ComputerService(providers['qwen'], ai_config, providers)
    from .ai.web_search import WebSearch
    computer_service.web_search = WebSearch(providers['gemini'])
    app.extensions['comet_computer'] = computer_service
    conversation_store = ConversationStore(app.config)
    app.extensions['comet_conversations'] = conversation_store
    from .ai.attachments import AttachmentStore
    attachments = AttachmentStore(ROOT / 'instance' / 'attachments')
    conversation_store.attachments = attachments
    from .ai.personalization import PersonalizationStore
    personalization = PersonalizationStore(conversation_store)
    computer_service.personalization = personalization
    app.extensions['comet_personalization'] = personalization
    app.teardown_appcontext(db.close_db)
    dummy_hash = generate_password_hash(secrets.token_urlsafe(32))

    def current_user():
        if 'user' not in g:
            g.user = None
            token = session.get('auth_token')
            if isinstance(token, str):
                try:
                    with db.cursor() as cursor:
                        cursor.execute(
                            'SELECT u.id, u.nome, u.email FROM usuarios u JOIN sessoes s '
                            'ON s.usuario_id=u.id WHERE s.token_hash=%s AND s.expira_em>UTC_TIMESTAMP()',
                            (sha256(token.encode()).hexdigest(),),
                        )
                        g.user = cursor.fetchone()
                finally:
                    db.close_db()
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

    def api_protected(message, include_code=False):
        def decorate(view):
            @wraps(view)
            def wrapper(*args, **kwargs):
                user = current_user()
                if not user:
                    payload = {'error': message}
                    if include_code:
                        payload['code'] = 'unauthorized'
                    return jsonify(payload), 401
                return view(user, *args, **kwargs)
            return wrapper
        return decorate

    from . import finance

    @app.get('/api/finance/dashboard')
    @api_protected('Entre novamente para acessar suas finanças.')
    def finance_dashboard(user):
        return jsonify(finance.dashboard(user['id']))

    @app.get('/api/finance/transactions')
    @api_protected('Entre novamente para acessar suas finanças.')
    def finance_history(user):
        try:
            return jsonify(finance.history(user['id'], int(request.args.get('limit', '30')), request.args.get('before'), request.args.get('state', 'active')))
        except ValueError as error:
            return jsonify(error=str(error)), 422

    @app.post('/api/finance/transactions')
    @limiter.limit('120 per minute')
    @api_protected('Entre novamente para acessar suas finanças.')
    def finance_receive(user):
        try:
            transaction, created = finance.receive(user['id'], request.get_json(silent=True))
        except ValueError as error:
            return jsonify(error=str(error)), 422
        if transaction is None:
            return jsonify(error='external_id já utilizado com dados diferentes.'), 409
        return jsonify(transaction=transaction, created=created), 201 if created else 200

    @app.post('/api/finance/interpret')
    @limiter.limit('30 per minute')
    @api_protected('Entre novamente para acessar suas finanças.')
    def finance_interpret(user):
        from .finance_interpretation import prepare_interpretation, validate_interpretation, SYSTEM, SCHEMA
        try:
            with computer_service.slot(user['id']):
                request_data = request.get_json(silent=True)
                if isinstance(request_data, dict) and request_data.get('provider', 'qwen') != 'gemini':
                    refresh_local_models()
                provider, data, context = prepare_interpretation(user['id'], request_data, providers)
                interpretation = validate_interpretation(providers[provider].structured(SYSTEM, data, SCHEMA))
                return jsonify(interpretation=interpretation, context=context)
        except ValueError as error:
            return jsonify(error=str(error)), 422
        except AIError as error:
            return jsonify(error=error.message, code=error.code), error.status

    @app.post('/api/finance/actions')
    @limiter.limit('120 per minute')
    @api_protected('Entre novamente para acessar suas finanças.')
    def finance_actions(user):
        from .finance_execution import execute_financial_actions, FinancialConflict
        try:
            return jsonify(execute_financial_actions(user['id'], request.get_json(silent=True)))
        except FinancialConflict as error:
            return jsonify(error=str(error)), 409
        except ValueError as error:
            return jsonify(error=str(error)), 422

    def issue_session(cursor, user_id):
        previous_token = session.get('auth_token')
        if isinstance(previous_token, str):
            cursor.execute('DELETE FROM sessoes WHERE token_hash=%s', (sha256(previous_token.encode()).hexdigest(),))
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + app.permanent_session_lifetime
        cursor.execute('DELETE FROM sessoes WHERE usuario_id=%s AND expira_em<=UTC_TIMESTAMP()', (user_id,))
        cursor.execute('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (%s,%s,%s)',
                    (sha256(token.encode()).hexdigest(), user_id, expires_at))
        return token

    def save_session(token):
        session.clear()
        session.permanent = True
        session['auth_token'] = token

    def app_bootstrap(page):
        user = current_user()
        return {
            'page': page,
            'user': {key: user[key] for key in ('id', 'nome', 'email')} if user else None,
            'csrfToken': generate_csrf(),
            'currentYear': datetime.now(timezone.utc).year,
        }

    def render_app(page):
        return next_page_html(app.config['NEXT_EXPORT_DIR'], page, app_bootstrap(page))

    @app.get('/_next/<path:filename>')
    def next_assets(filename):
        return send_from_directory(Path(app.config['NEXT_EXPORT_DIR']) / '_next', filename)

    @app.get('/<page>.txt')
    def next_route_payload(page):
        route = 'index' if page == 'index' else page.removesuffix('.html')
        if route not in APP_PAGES or (route != 'index' and page != f'{route}.html'):
            return jsonify(error='Página inválida.'), 404
        if route != 'index' and not current_user():
            return jsonify(error='Entre novamente para acessar sua conta.'), 401
        return send_from_directory(app.config['NEXT_EXPORT_DIR'], f'{page}.txt', mimetype='text/x-component')

    @app.get('/api/bootstrap')
    def bootstrap_session():
        page = request.args.get('page', 'computer')
        if page not in APP_PAGES:
            return jsonify(error='Página inválida.'), 400
        if page != 'index' and not current_user():
            return jsonify(error='Entre novamente para acessar sua conta.'), 401
        return jsonify(app_bootstrap(page))

    @app.get('/')
    @app.get('/index.html')
    def landing():
        if current_user():
            return redirect('/principal.html')
        return render_app('index')

    @app.get('/principal.html')
    @protected
    def principal():
        destination = '/computer.html?new=1'
        if request.args.get('settings') == 'personalization':
            destination += '&settings=personalization'
        return redirect(destination)

    def refresh_local_models():
        names = providers['qwen'].models()
        for name in tuple(providers):
            if name not in ('qwen', 'gemini') and name not in names:
                providers.pop(name, None)
        for name in names:
            if name not in providers:
                providers[name] = OllamaProvider(replace(ai_config, model=name))
                providers[name].label = name
        return names

    @app.get('/api/ai/models')
    @api_protected('Entre novamente para escolher um modelo.')
    def computer_models(user):
        try:
            names = refresh_local_models()
            local_error = None
        except AIError:
            names = []
            local_error = 'Não foi possível conectar ao Ollama. Abra o aplicativo e tente novamente.'
        response = jsonify(models=[{'id': 'gemini', 'name': 'Gemini', 'configured': bool(providers['gemini'].key)},
                                   *[{'id': name, 'name': name, 'configured': True} for name in names]],
                           default_model=ai_config.model if ai_config.model in names else next(iter(names), None),
                           local_error=local_error)
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/ai/attachments/<token>/preview')
    @api_protected('Entre novamente para ver o anexo.')
    def attachment_preview(user, token):
        try:
            data = attachments.read(user['id'], token)
            if data.get('kind') != 'image':
                raise AIError('attachment_missing', 404)
            response = Response(base64.b64decode(data['image']), mimetype='image/jpeg')
            response.headers['Cache-Control'] = 'private, no-store'
            return response
        except AIError as exc:
            return jsonify(error=exc.message), exc.status

    @app.post('/api/ai/attachments')
    @limiter.limit('20 per minute')
    @api_protected('Entre novamente para anexar arquivos.')
    def computer_attachment(user):
        if set(request.files) != {'file'}:
            return jsonify(error='Selecione um arquivo.'), 422
        try:
            response = jsonify(attachments.upload(user['id'], request.files['file']))
            response.headers['Cache-Control'] = 'no-store'
            return response
        except AIError as exc:
            return jsonify(error=exc.message), exc.status

    @app.post('/api/ai/conversations/<cid>/messages/<tid>/regenerate')
    @app.post('/api/ai/chat')
    @limiter.limit('10 per minute')
    @api_protected('Entre novamente para conversar com a Computer.', include_code=True)
    def computer_chat(user, cid=None, tid=None):
        try:
            request_payload = request.get_json(silent=True)
            if tid is not None:
                if not isinstance(request_payload, dict) or 'request_id' not in request_payload or set(request_payload) - {'request_id', 'provider', 'web_search'}:
                    raise AIError('invalid_request', 422)
                request_payload = {
                    **request_payload, 'conversation_id': cid, 'regenerate': tid,
                    'message': 'Reescrever resposta.',
                }
            if isinstance(request_payload, dict) and request_payload.get('anonymous') is True:
                from .ai.ephemeral import EphemeralStore
                payload = EphemeralStore.validate(request_payload, computer_service)
                store = EphemeralStore()
            else:
                payload = conversation_store.validate(request_payload)
                store = conversation_store
            if payload.get('provider', 'qwen') != 'gemini':
                refresh_local_models()
            event_stream = computer_service.stream_saved(user['id'], payload, store)
            first_event = next(event_stream)
        except AIError as exc:
            app.logger.warning('Computer request failed (%s)', exc.code)
            return jsonify(error=exc.message, code=exc.code), exc.status

        def encode(event):
            return json.dumps(event, ensure_ascii=False) + '\n'

        def generate():
            try:
                yield encode(first_event)
                for event in event_stream:
                    yield encode(event)
            except AIError as exc:
                app.logger.warning('Computer stream failed (%s)', exc.code)
                yield encode({'type': 'error', 'error': exc.message, 'code': exc.code})
            except Exception:
                app.logger.exception('Unexpected Computer stream failure')
                yield encode({'type': 'error', 'error': 'A resposta foi interrompida. Tente novamente.'})
            finally:
                event_stream.close()

        response = Response(generate(), content_type='application/x-ndjson; charset=utf-8')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Accel-Buffering'] = 'no'
        response.call_on_close(event_stream.close)
        return response

    @app.get('/api/ai/conversations')
    @api_protected('Entre novamente para acessar suas conversas.')
    def computer_conversations(user):
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
    @api_protected('Entre novamente para acessar suas conversas.')
    def computer_conversation_preview(user, cid):
        try:
            response = jsonify(conversation_store.preview(user['id'], cid))
            response.headers['Cache-Control'] = 'no-store'
            return response
        except AIError as exc:
            return jsonify(error=exc.message, code=exc.code), exc.status

    @app.get('/api/ai/conversations/<cid>')
    @api_protected('Entre novamente para acessar suas conversas.')
    def computer_conversation(user, cid):
        try:
            return jsonify(conversation_store.get(user['id'], cid, request.args.get('before')))
        except AIError as exc:
            return jsonify(error=exc.message, code=exc.code), exc.status

    @app.route('/api/ai/conversations/<cid>', methods=['PATCH', 'DELETE'])
    @limiter.limit('30 per minute')
    @api_protected('Entre novamente para acessar suas conversas.')
    def change_computer_conversation(user, cid):
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
    @api_protected('Entre novamente para editar suas mensagens.')
    def edit_computer_message(user, cid, tid):
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
    @api_protected('Entre novamente para personalizar o Computer.')
    def computer_personalization(user):
        try:
            if request.method == 'GET':
                data = personalization.get(user['id'])
            else:
                data = personalization.update(user['id'], request.get_json(silent=True))
            response = jsonify(data)
            response.headers['Cache-Control'] = 'no-store'
            return response
        except AIError as exc:
            return jsonify(error=exc.message), exc.status
        except DatabaseError:
            return jsonify(error='A personalização precisa da atualização do banco. Execute configurar_banco.bat e recarregue esta página.'), 503

    @app.get('/recentes.html')
    @protected
    def recent_chats_page():
        return render_app('recentes')

    @app.get('/computer.html')
    @protected
    def computer():
        return render_app('computer')

    @app.get('/graficos.html')
    @protected
    def graficos():
        return render_app('graficos')

    @app.get('/robots.txt')
    def robots():
        return send_from_directory(ROOT, 'robots.txt', mimetype='text/plain')

    @app.get('/llms.txt')
    def llms():
        return send_from_directory(ROOT, 'llms.txt', mimetype='text/plain')

    @app.get('/manifest.webmanifest')
    def manifest():
        return send_from_directory(ROOT, 'manifest.webmanifest')

    @app.get('/aprender.html')
    @protected
    def aprender():
        return render_app('aprender')

    @app.get('/descobrir.html')
    @protected
    def descobrir():
        return render_app('descobrir')

    @app.get('/api/news')
    @limiter.limit('30 per minute')
    @api_protected('Entre novamente para ver as notícias.', include_code=True)
    def discovery_news(user):
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
        age_text = request.form.get('age', '').strip()
        if not 1 <= len(age_text) <= 3 or not age_text.isascii() or not age_text.isdigit() or not 1 <= int(age_text) <= 120:
            return jsonify(error='Informe uma idade inteira entre 1 e 120 anos.'), 422
        age = int(age_text)
        password_hash = generate_password_hash(password)
        try:
            with db.cursor(write=True) as cursor:
                cursor.execute('INSERT INTO usuarios (nome, email, senha, idade) VALUES (%s,%s,%s,%s)',
                            (name, email, password_hash, age))
                token = issue_session(cursor, cursor.lastrowid)
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
            with db.cursor() as cursor:
                cursor.execute('SELECT id, senha FROM usuarios WHERE email=%s', (email,))
                user = cursor.fetchone()
            password_matches = check_password_hash(user['senha'] if user else dummy_hash, password)
        except (ValueError, TypeError):
            password_matches = False
        if not user or not password_matches:
            return jsonify(error='E-mail ou senha incorretos.'), 401
        with db.cursor(write=True) as cursor:
            token = issue_session(cursor, user['id'])
        save_session(token)
        return jsonify(ok=True)

    @app.post('/logout')
    def logout():
        token = session.get('auth_token')
        if isinstance(token, str):
            with db.cursor(write=True) as cursor:
                cursor.execute('DELETE FROM sessoes WHERE token_hash=%s', (sha256(token.encode()).hexdigest(),))
        session.clear()
        return redirect('/')

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN' if request.endpoint == 'descobrir' else 'DENY'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(self), geolocation=(self)'
        if response.mimetype in ('text/html', 'application/json', 'text/x-component'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(CSRFError)
    def csrf_error(error):
        return jsonify(error='O formulário expirou. Atualize a página e tente novamente.'), 400

    @app.errorhandler(DatabaseError)
    def database_error(error):
        app.logger.error('Falha na conexão/operação MySQL (código %s)', error.errno)
        if request.path.startswith('/api/finance/') and error.errno in (1146, 1054):
            return jsonify(error='Prepare as tabelas financeiras executando configurar_banco.bat com o administrador do MySQL.'), 503
        return jsonify(error='Não foi possível acessar sua conta agora. Tente novamente em instantes.'), 503

    @app.errorhandler(HTTPException)
    def http_error(error):
        response = error.get_response()
        response.data = app.json.dumps({'error': 'Muitas tentativas. Aguarde um minuto e tente novamente.'
                                      if error.code == 429 else 'Não foi possível atender esta solicitação.'})
        response.content_type = 'application/json'
        return response

    return app
