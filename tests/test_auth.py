import re
import unittest
import uuid

from mysql.connector import Error as DatabaseError
from werkzeug.security import check_password_hash

from ascenda import create_app, db


def csrf(client):
    html = client.get('/', follow_redirects=True).get_data(as_text=True)
    return re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)


class PublicSecurityTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({'TESTING': True, 'SECRET_KEY': 'test-key-' * 8})
        self.client = self.app.test_client()

    def test_private_pages_require_login(self):
        for route in ('/principal.html', '/graficos.html'):
            response = self.client.get(route)
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.location, '/?login=1')

    def test_csrf_and_private_files(self):
        for route in ('/api/auth/signup', '/api/auth/login', '/logout'):
            self.assertEqual(self.client.post(route).status_code, 400)
        for route in ('/.env', '/requirements.txt', '/ascenda/__init__.py'):
            self.assertEqual(self.client.get(route).status_code, 404)

    def test_validation_and_rate_limit(self):
        token = csrf(self.client)
        for _ in range(10):
            self.assertEqual(self.client.post('/api/auth/login', data={
                'csrf_token': token, 'email': 'invalid', 'password': 'x'
            }).status_code, 401)
        self.assertEqual(self.client.post('/api/auth/login', data={
            'csrf_token': token, 'email': 'invalid', 'password': 'x'
        }).status_code, 429)


class MySQLAuthTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({'TESTING': True, 'RATELIMIT_ENABLED': False})
        self.client = self.app.test_client()
        self.email = f'qa-{uuid.uuid4().hex}@example.com'
        self.password = 'Uma-senha-de-teste-932!'
        try:
            with self.app.app_context(), db.cursor() as cur:
                cur.execute('SELECT id FROM usuarios LIMIT 0')
        except DatabaseError:
            self.skipTest('Configure o MySQL com configurar_banco.bat para os testes de integração.')
        self.addCleanup(self.cleanup_user)

    def cleanup_user(self):
        with self.app.app_context(), db.cursor(write=True) as cur:
            cur.execute('DELETE FROM usuarios WHERE email=%s', (self.email,))

    def signup(self, **overrides):
        data = dict(csrf_token=csrf(self.client), name='Pessoa <script>alert(1)</script>',
                    email=self.email, password=self.password, confirmation=self.password)
        data.update(overrides)
        return self.client.post('/api/auth/signup', data=data)

    def test_signup_login_profile_logout_and_replay(self):
        self.assertEqual(self.signup().status_code, 201)
        cookie = self.client.get_cookie('ascenda_session')
        self.assertTrue(cookie.http_only)
        self.assertEqual(cookie.same_site, 'Lax')
        with self.app.app_context(), db.cursor() as cur:
            cur.execute('SELECT senha FROM usuarios WHERE email=%s', (self.email,))
            stored = cur.fetchone()['senha']
            self.assertNotEqual(stored, self.password)
            self.assertTrue(check_password_hash(stored, self.password))
        page = self.client.get('/principal.html', follow_redirects=True)
        self.assertEqual(page.status_code, 200)
        self.assertIn(self.email, page.get_data(as_text=True))
        self.assertIn('&lt;script&gt;', page.get_data(as_text=True))
        self.assertNotIn('<script>alert(1)</script>', page.get_data(as_text=True))
        self.assertEqual(self.client.get('/graficos.html').status_code, 200)
        self.assertEqual(self.client.post('/logout', data={'csrf_token': csrf(self.client)}).status_code, 302)
        self.client.set_cookie('ascenda_session', cookie.value)
        self.assertEqual(self.client.get('/principal.html').status_code, 302)
        response = self.client.post('/api/auth/login', data={
            'csrf_token': csrf(self.client), 'email': self.email.upper(), 'password': self.password})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/principal.html', follow_redirects=True).status_code, 200)

    def test_bad_password_duplicate_and_expired_session(self):
        self.assertEqual(self.signup(confirmation='different').status_code, 422)
        self.assertEqual(self.signup(password='short', confirmation='short').status_code, 422)
        self.assertEqual(self.signup().status_code, 201)
        self.assertEqual(self.signup(email=self.email.upper()).status_code, 409)
        self.client.post('/logout', data={'csrf_token': csrf(self.client)})
        self.assertEqual(self.client.post('/api/auth/login', data={
            'csrf_token': csrf(self.client), 'email': self.email, 'password': 'wrong'
        }).status_code, 401)
        self.assertEqual(self.client.get('/principal.html').status_code, 302)
        self.client.post('/api/auth/login', data={
            'csrf_token': csrf(self.client), 'email': self.email, 'password': self.password})
        with self.app.app_context(), db.cursor(write=True) as cur:
            cur.execute('UPDATE sessoes SET expira_em=UTC_TIMESTAMP()-INTERVAL 1 HOUR '
                        'WHERE usuario_id=(SELECT id FROM usuarios WHERE email=%s)', (self.email,))
        self.assertEqual(self.client.get('/principal.html').status_code, 302)


if __name__ == '__main__':
    unittest.main()
