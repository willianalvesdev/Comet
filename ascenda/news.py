"""Marketaux financial feed. Tokens and requests stay on the server."""
import hashlib
import ipaddress
import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NewsError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(value, maximum):
    if not isinstance(value, str):
        return ''
    parser = PlainText()
    parser.feed(value[:20000])
    return ' '.join(unescape(''.join(parser.parts)).split())[:maximum]


def public_url(value):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 32 for c in value):
        return None
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or '').lower()
        if parsed.scheme not in ('https', 'http') or not host or parsed.username or parsed.password:
            return None
        if host == 'localhost' or host.endswith(('.localhost', '.local')):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            pass
        return value
    except ValueError:
        return None


def is_political(item):
    text = ' '.join(plain(item.get(field), 20000) for field in
                    ('title', 'description', 'snippet', 'keywords'))
    text = ''.join(c for c in unicodedata.normalize('NFKD', text.casefold())
                   if not unicodedata.combining(c))
    # Financial policy and company presidents are not party politics.
    text = re.sub(r'\bpoliticas?\s+(monetaria|cambial|de dividendos|de credito|de investimentos)\b', '', text)
    return bool(re.search(
        r'\b(politic[ao]s?|eleic\w*|eleitor\w*|partidari\w*|campanha presidencial|'
        r'congresso nacional|senado|senador\w*|deputad\w*|parlament\w*|'
        r'governo|governador\w*|prefeit\w*|casa branca|impeachment|'
        r'presidente da republica|presidente dos estados unidos|'
        r'trump|bolsonaro|lula|biden|putin|zelensky|netanyahu|milei|xi jinping)\b', text))


def normalize_article(item):
    if not isinstance(item, dict):
        return None
    if is_political(item):
        return None
    url, title = public_url(item.get('url')), plain(item.get('title'), 300)
    if not url or not title:
        return None
    source = plain(item.get('source'), 120) or urlsplit(url).hostname
    sources, seen = [{'name': source, 'url': url}], {source.casefold()}
    similar = item.get('similar')
    for other in (similar if isinstance(similar, list) else [])[:30]:
        if not isinstance(other, dict) or is_political(other):
            continue
        other_url, name = public_url(other.get('url')), plain(other.get('source'), 120)
        if other_url and name and name.casefold() not in seen:
            seen.add(name.casefold())
            sources.append({'name': name, 'url': other_url})
    published = None
    try:
        date = datetime.fromisoformat(item.get('published_at', '').replace('Z', '+00:00'))
        published = date.replace(tzinfo=date.tzinfo or timezone.utc).isoformat()
    except (ValueError, AttributeError, TypeError):
        pass
    return dict(id=hashlib.sha256(url.encode()).hexdigest()[:24], title=title,
                description=plain(item.get('description') or item.get('snippet'), 550),
                url=url, image=public_url(item.get('image_url')), published_at=published,
                source=source, sources=sources)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_marketaux(token, page):
    query = urlencode({'api_token': token, 'language': 'pt', 'group_similar': 'true',
                       'sort': 'published_at', 'page': page,
                       'search': '(finanças | investimentos | bolsa | ações | empresas | juros | economia) '
                                 '-eleições -eleitoral -partidário -senado -deputado '
                                 '-Trump -Bolsonaro -Lula -Biden -Putin -impeachment'})
    request = Request('https://api.marketaux.com/v1/news/all?' + query,
                      headers={'Accept': 'application/json', 'User-Agent': 'Ascenda/1.0'})
    try:
        with build_opener(NoRedirect).open(request, timeout=10) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError
        result = json.loads(raw)
        if not isinstance(result, dict) or not isinstance(result.get('data'), list):
            raise ValueError
        return result
    except HTTPError as exc:
        status = exc.code
        exc.close()
        if status in (401, 403):
            raise NewsError('configuration', 'O serviço de notícias ainda não está disponível.') from None
        if status in (402, 429):
            raise NewsError('quota', 'As notícias estão temporariamente indisponíveis. Tente novamente mais tarde.') from None
        raise NewsError('unavailable', 'Não foi possível atualizar as notícias. Tente novamente em instantes.') from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise NewsError('unavailable', 'Não foi possível atualizar as notícias. Tente novamente em instantes.') from None


class NewsService:
    def __init__(self, token, fetcher=fetch_marketaux, clock=time.monotonic):
        self.token, self.fetcher, self.clock = token, fetcher, clock
        self.cache, self.errors = {}, {}
        self.lock = Lock()

    def get(self, page):
        if not self.token:
            raise NewsError('configuration', 'As notícias estarão disponíveis em breve.')
        with self.lock:
            now = self.clock()
            cached, failure = self.cache.get(page), self.errors.get(page)
            if cached and now - cached[0] < 1800:
                return dict(cached[1], stale=False)
            if failure and now < failure[0]:
                if cached and now - cached[0] < 86400:
                    return dict(cached[1], stale=True)
                raise failure[1]
            try:
                payload = self.fetcher(self.token, page)
                articles, seen = [], set()
                for item in payload['data'][:100]:
                    article = normalize_article(item)
                    if article and article['id'] not in seen:
                        seen.add(article['id'])
                        articles.append(article)
                meta = payload.get('meta') or {}
                found, limit = int(meta.get('found', 0)), int(meta.get('limit', len(payload['data']) or 1))
                result = dict(articles=articles, page=page,
                              has_more=bool(payload['data']) and page < 10 and page * limit < found,
                              updated_at=datetime.now(timezone.utc).isoformat(), provider='Marketaux')
                self.cache[page] = (now, result)
                self.errors.pop(page, None)
                return dict(result, stale=False)
            except (TypeError, ValueError, KeyError):
                error = NewsError('unavailable', 'Não foi possível atualizar as notícias. Tente novamente em instantes.')
            except NewsError as exc:
                error = exc
            self.errors[page] = (now + 300, error)
            if cached and now - cached[0] < 86400:
                return dict(cached[1], stale=True)
            raise error
