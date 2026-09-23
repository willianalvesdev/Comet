"""Flask application and authentication for Ascenda."""
import os
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps
from hashlib import sha256
from pathlib import Path

from dotenv import load_dotenv
from email_validator import EmailNotValidError, validate_email
from flask import Flask, g, jsonify, redirect, render_template, request, session
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
        SESSION_REFRESH_EACH_REQUEST=False, PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        MAX_CONTENT_LENGTH=16 * 1024, MAX_FORM_MEMORY_SIZE=16 * 1024,
        RATELIMIT_STORAGE_URI=os.getenv('RATELIMIT_STORAGE_URI', 'memory://'),
        RATELIMIT_HEADERS_ENABLED=True,
        MARKETAUX_API_TOKEN=os.getenv('MARKETAUX_API_TOKEN', ''),
    )
    if test_config:
        app.config.update(test_config)
    if (not app.config['SECRET_KEY'] or len(app.config['SECRET_KEY']) < 32
            or app.config['SECRET_KEY'].startswith('gere-')):
        raise RuntimeError('Execute iniciar.bat para preparar a configuração local.')
    CSRFProtect(app)
    limiter = Limiter(key_func=get_remote_address, app=app)
    app.extensions['ascenda_limiter'] = limiter
    from .news import NewsService, NewsError
    news_service = NewsService(app.config['MARKETAUX_API_TOKEN'])
    app.extensions['ascenda_news'] = news_service
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
        return render_template('index.html')

    @app.get('/principal.html')
    @protected
    def principal():
        return render_template('principal.html', user=g.user)

    @app.get('/graficos.html')
    @protected
    def graficos():
        return render_template('graficos.html', user=g.user)

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
    def financial_news():
        if not current_user():
            return jsonify(error='Entre novamente para ver as notícias.', code='unauthorized'), 401
        try:
            page = int(request.args.get('page', '1'))
            if not 1 <= page <= 10:
                raise ValueError
        except ValueError:
            return jsonify(error='Página inválida.'), 400
        try:
            return jsonify(news_service.get(page))
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
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        # Keep the microphone available for the dictation feature.
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(self), geolocation=()'
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
