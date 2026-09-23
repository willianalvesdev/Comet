"""NewsAPI discovery feed. Tokens and requests stay on the server."""
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


PAGE_SIZE = 100
TOPICS = {
    'technology': 'technology OR science OR tecnologia OR ciencia',
    'business': 'finance OR business OR economia OR investimentos',
    'culture': 'art OR culture OR arte OR cultura',
    'sports': 'sports OR football OR esportes OR futebol',
    'entertainment': 'entertainment OR music OR cinema OR entretenimento',
}
EXCLUSIONS = (' NOT (crime OR murder OR violence OR porn OR sex OR robbery OR war OR '
              'homicidio OR assassinato OR estupro OR tiroteio)')
UNSUITABLE_TERMS = re.compile(
    r'\b(crim\w*|murder\w*|homicid\w*|assassin\w*|robber\w*|roub\w*|'
    r'furto\w*|theft|stolen|fraud\w*|scam\w*|golpes?|police|policial|policiais|'
    r'arrest\w*|prisao|presos?|sequestr\w*|kidnap\w*|trafic\w*|'
    r'terror\w*|shootings?|tiroteio\w*|lavagem de dinheiro|money laundering|'
    r'corrup\w*|extor\w*|violen\w*|delito\w*|asesinat\w*|'
    r'estafa\w*|meurtre\w*|betrug\w*|mord\w*|porn\w*|sex\w*|nude\w*|'
    r'nudi\w*|erotic\w*|estupro\w*|rape|rapist\w*|abuso\w*|onlyfans|'
    r'massacr\w*|guerra\w*|war|warfare|bomb\w*|gore|suicid\w*|'
    r'esfaque\w*|stabb\w*|behead\w*|tortur\w*|agress\w*)\b')


def topic_selection(value):
    values = tuple(sorted(set(filter(None, value.split(',')))))
    if any(topic not in TOPICS for topic in values):
        raise ValueError('Tópico inválido.')
    return values


def news_query(topics=()):
    subjects = ' OR '.join(TOPICS[topic] for topic in (topics or TOPICS))
    if not topics:
        subjects += ' OR health OR travel OR education OR world OR politics'
    return '(' + subjects + ')' + EXCLUSIONS


def suitable_news(item):
    text = ' '.join(plain(item.get(field), 20000) for field in ('title', 'description', 'content'))
    text = ''.join(c for c in unicodedata.normalize('NFKD', text.casefold())
                   if not unicodedata.combining(c))
    return not UNSUITABLE_TERMS.search(text)


def normalize_article(item):
    if not isinstance(item, dict):
        return None
    if not suitable_news(item):
        return None
    url, title = public_url(item.get('url')), plain(item.get('title'), 300)
    image = public_url(item.get('urlToImage'))
    if not url or not title or not image:
        return None
    source_data = item.get('source')
    source = plain(source_data.get('name'), 120) if isinstance(source_data, dict) else ''
    source = source or urlsplit(url).hostname
    sources = [{'name': source, 'url': url}]
    published = None
    try:
        date = datetime.fromisoformat(item.get('publishedAt', '').replace('Z', '+00:00'))
        published = date.replace(tzinfo=date.tzinfo or timezone.utc).isoformat()
    except (ValueError, AttributeError, TypeError):
        pass
    return dict(id=hashlib.sha256(url.encode()).hexdigest()[:24], title=title,
                description=plain(item.get('description') or item.get('content'), 550),
                url=url, image=image, published_at=published,
                source=source, sources=sources)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_newsapi(token, page, topics=(), mode='for-you'):
    query = urlencode({'q': news_query(topics), 'searchIn': 'title,description',
                       'sortBy': 'popularity' if mode == 'top' else 'publishedAt', 'pageSize': PAGE_SIZE, 'page': page})
    request = Request('https://newsapi.org/v2/everything?' + query,
                      headers={'Accept': 'application/json', 'User-Agent': 'Ascenda/1.0',
                               'X-Api-Key': token})
    try:
        with build_opener(NoRedirect).open(request, timeout=10) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError
        result = json.loads(raw)
        if not isinstance(result, dict) or result.get('status') != 'ok' or not isinstance(result.get('articles'), list):
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
    def __init__(self, token, fetcher=fetch_newsapi, clock=time.monotonic):
        self.token, self.fetcher, self.clock = token, fetcher, clock
        self.cache, self.errors = {}, {}
        self.lock = Lock()

    def get(self, page, topics=(), mode='for-you'):
        if not self.token:
            raise NewsError('configuration', 'As notícias estarão disponíveis em breve.')
        key = (page, topics, mode)
        with self.lock:
            now = self.clock()
            cached, failure = self.cache.get(key), self.errors.get(key)
            if cached and now - cached[0] < 1800:
                return dict(cached[1], stale=False)
            if failure and now < failure[0]:
                if cached and now - cached[0] < 86400:
                    return dict(cached[1], stale=True)
                raise failure[1]
            try:
                payload = self.fetcher(self.token, page, topics, mode)
                articles, seen = [], set()
                for item in payload['articles'][:100]:
                    article = normalize_article(item)
                    if article and article['id'] not in seen:
                        seen.add(article['id'])
                        articles.append(article)
                found, limit = int(payload.get('totalResults', 0)), PAGE_SIZE
                result = dict(articles=articles, page=page,
                              has_more=bool(payload['articles']) and page < 10 and page * limit < found,
                              updated_at=datetime.now(timezone.utc).isoformat(), provider='NewsAPI')
                if len(self.cache) >= 64:
                    self.cache.pop(next(iter(self.cache)))
                self.cache[key] = (now, result)
                self.errors.pop(key, None)
                return dict(result, stale=False)
            except (TypeError, ValueError, KeyError):
                error = NewsError('unavailable', 'Não foi possível atualizar as notícias. Tente novamente em instantes.')
            except NewsError as exc:
                error = exc
            if len(self.errors) >= 64:
                self.errors.pop(next(iter(self.errors)))
            self.errors[key] = (now + 300, error)
            if cached and now - cached[0] < 86400:
                return dict(cached[1], stale=True)
            raise error
