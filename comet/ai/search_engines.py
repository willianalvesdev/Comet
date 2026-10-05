import http.client
import json
import os
import re
import html
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode, urlsplit
from xml.etree import ElementTree
from .errors import AIError


def freshness(query):
    text = query.casefold()
    if re.search(r"\b(hoje|agora|today|24 horas)\b", text):
        return 1
    if re.search(r"\b(semana|week|últim[oa]s?|ultim[oa]s?|recentes?|notícias|noticias|atual(?:mente)?)\b", text):
        return 7
    return None


def read(host, path, headers=None):
    conn = http.client.HTTPSConnection(host, timeout=12)
    try:
        conn.request('GET', path, headers={'User-Agent':'Comet/1.0', **(headers or {})})
        response = conn.getresponse()
        raw = response.read(524289)
        if response.status != 200 or len(raw) > 524288:
            raise AIError('provider_unavailable',503)
        return raw
    except (OSError, http.client.HTTPException):
        raise AIError('provider_unavailable',503) from None
    finally:
        conn.close()


def diversified(items, limit=6):
    from .web_search import safe_url
    first, extra, seen, counts = [], [], set(), {}
    for item in items:
        url = safe_url(item.get('url'))
        domain = (item.get('domain') or urlsplit(url or '').hostname or '').lower().removeprefix('www.')
        canonical = (url or '').split('#')[0].rstrip('/')
        if not url or canonical in seen or not domain:
            continue
        seen.add(canonical)
        count = counts.get(domain,0)
        counts[domain] = count + 1
        if count >= 2:
            continue
        (first if count == 0 else extra).append({**item,'url':url,'domain':domain})
    return (first + extra)[:limit]


def result(items, query, engine):
    items = diversified(items)
    sources = [{**item, 'excerpt':item.get('excerpt','')[:600]} for item in items]
    snippets = [{'source':i+1,'excerpt':item.get('excerpt','')[:240],
                 'published_at':item.get('published_at')} for i,item in enumerate(items)]
    return {'sources':sources,'queries':[query],'suggestions':'','engine':engine,
            'retrieved_at':datetime.now(timezone.utc).isoformat()}, json.dumps(snippets,ensure_ascii=False)


def news_search(query):
    from .web_search import safe_url
    days = freshness(query) or 7
    params = {'q':f'{query} when:{days}d','hl':'pt-BR','gl':'BR','ceid':'BR:pt-419'}
    raw = read('news.google.com','/rss/search?'+urlencode(params))
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise AIError('provider_unavailable',503)
    try:
        root = ElementTree.fromstring(raw)
        if root.tag != 'rss':
            raise ValueError()
        items = []
        now = datetime.now(timezone.utc)
        for entry in root.findall('./channel/item')[:80]:
            try:
                date = parsedate_to_datetime(entry.findtext('pubDate') or '')
                if not date.tzinfo or date < now-timedelta(days=days) or date > now+timedelta(hours=2):
                    continue
            except (ValueError,TypeError,OverflowError):
                continue
            publisher = entry.find('source')
            publisher_url = safe_url(publisher.get('url')) if publisher is not None else None
            title = html.unescape(entry.findtext('title') or '')[:200]
            items.append({'url':entry.findtext('link'),'title':title,
                          'domain':urlsplit(publisher_url).hostname if publisher_url else None,
                          'published_at':date.isoformat(), 'excerpt':title,
                          'evidence_type':'headline'})
        return result(items,query,'Google Notícias')
    except (ValueError,ElementTree.ParseError):
        raise AIError('provider_unavailable',503) from None


def brave_search(query):
    key = os.getenv('BRAVE_SEARCH_API_KEY','').strip()
    if not key:
        raise AIError('provider_missing',503)
    days = freshness(query)
    params = {'q':query,'count':20,'country':'BR','search_lang':'pt-br','extra_snippets':'true'}
    if days:
        params['freshness'] = 'pd' if days == 1 else 'pw'
    raw = read('api.search.brave.com','/res/v1/web/search?'+urlencode(params),
               {'Accept':'application/json','X-Subscription-Token':key})
    try:
        data = json.loads(raw)
        items = [{'url':entry.get('url'),'title':str(entry.get('title',''))[:200],
                  'excerpt':re.sub('<[^>]+>','',html.unescape(str(entry.get('description',''))))[:600],
                  'published_at':entry.get('page_age') or entry.get('age')}
                 for entry in data.get('web',{}).get('results',[])[:20]]
        return result(items,query,'Brave Search')
    except (ValueError,TypeError,AttributeError):
        raise AIError('provider_unavailable',503) from None


def result_date(entry, now):
    text = entry.get('publishedDate')
    if text:
        try:
            date = datetime.fromisoformat(text.replace('Z','+00:00'))
            return date if date.tzinfo else date.replace(tzinfo=timezone.utc), False
        except (ValueError,TypeError,AttributeError):
            pass
    relative = str(entry.get('pubdate') or entry.get('metadata') or '').casefold()
    match = re.search(r'(?:há|ha|^|\b)(\s*\d+)\s*(minutos?|minutes?|mins?|horas?|hours?|hrs?|dias?|days?)\b',relative)
    if match:
        amount = min(int(match[1]),100000)
        unit = match[2]
        seconds = amount * (60 if unit.startswith('min') else 3600 if unit.startswith(('hor','hour','hr')) else 86400)
        return now-timedelta(seconds=seconds), True
    return None, False


def searxng_search(query):

    base = urlsplit(os.getenv('SEARXNG_URL','').strip())
    if (base.scheme not in ('http','https') or not base.hostname or base.username
            or base.password or base.query or base.fragment
            or (base.scheme == 'http' and base.hostname not in ('localhost','127.0.0.1','::1','searxng'))):
        raise AIError('provider_missing',503)
    days = freshness(query)
    params = {'q':query,'format':'json','language':'pt-BR','safesearch':1}
    is_news = bool(re.search(r'notícias|noticias|news',query,re.I))
    if is_news:

        params['categories'] = 'news'
    elif days:
        params['time_range'] = 'day' if days == 1 else 'month'
    conn = (http.client.HTTPSConnection if base.scheme == 'https' else http.client.HTTPConnection)(base.hostname,base.port,timeout=12)
    try:
        path = base.path.rstrip('/')
        if not path.endswith('/search'):
            path += '/search'
        conn.request('GET',path+'?'+urlencode(params),headers={'Accept':'application/json'})
        response = conn.getresponse()
        raw = response.read(524289)
        if response.status != 200 or len(raw)>524288:
            raise AIError('provider_unavailable',503)
        data = json.loads(raw)
        items = []
        now = datetime.now(timezone.utc)
        for entry in data.get('results',[])[:40]:
            date, approximate = result_date(entry,now)
            if days:
                if date and (date < now-timedelta(days=days) or date > now+timedelta(hours=2)):
                    continue
                if is_news and not date:
                    continue
            date_text = date.isoformat() if date else None
            items.append({'url':entry.get('url'),'title':str(entry.get('title',''))[:200],
                          'excerpt':re.sub('<[^>]+>','',html.unescape(str(entry.get('content',''))))[:600],
                          'published_at':date_text,'date_approximate':approximate})
        return result(items,query,'SearXNG')
    except (OSError,http.client.HTTPException,ValueError,TypeError,AttributeError):
        raise AIError('provider_unavailable',503) from None
    finally:
        conn.close()
