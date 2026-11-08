"""Bounded Elasticsearch HTTP, explicit inference discovery and index setup."""
import argparse
import datetime as dt
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


class ElasticError(RuntimeError):
    pass


def read_env(path):
    """Read internally; never expand/execute shell text or emit env values."""
    values = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:]
        key, separator, value = line.partition('=')
        if not separator:
            raise ValueError('env file must use KEY=VALUE lines')
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        values[key.strip()] = value
    return values


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ElasticError('Elasticsearch redirects are refused')


class Client:
    def __init__(self, values, read_only=False):
        self.url = values.get('ES_URL', '').rstrip('/')
        parsed = urllib.parse.urlsplit(self.url)
        local = parsed.hostname in ('localhost', '127.0.0.1', '::1')
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or (parsed.scheme != 'https' and not (parsed.scheme == 'http' and local)):
            raise ValueError('ES_URL must use HTTPS (HTTP allowed only on loopback), without embedded credentials')
        keys = ('ES_READ_KEY', 'ES_API_KEY') if read_only else ('ES_ADMIN_KEY', 'ES_API_KEY')
        self.key = next((values[k] for k in keys if values.get(k)), None)
        if not self.key:
            raise ValueError('required Elasticsearch API key is not configured')
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, method, path, body=None, ndjson=False, allow_404=False):
        data = body.encode() if ndjson else (json.dumps(body).encode() if body is not None else None)
        request = urllib.request.Request(self.url + path, data=data, method=method,
                                         headers={'Authorization': 'ApiKey ' + self.key,
                                                  'Content-Type': 'application/x-ndjson' if ndjson else 'application/json'})
        try:
            with self.opener.open(request, timeout=30) as response:
                data = response.read(25_000_001)
                if len(data) > 25_000_000:
                    raise ElasticError('Elasticsearch response exceeds bound')
                return json.loads(data) if data else {}
        except urllib.error.HTTPError as error:
            if allow_404 and error.code == 404:
                return None
            # No server body, URL, credentials or exception repr enters output.
            raise ElasticError('Elasticsearch HTTP ' + str(error.code)) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ElasticError('Elasticsearch transport unavailable') from None


def select_inference(payload, requested=None, task='embedding'):
    endpoints = payload.get('endpoints', payload.get('inference_endpoints', []))
    types = {'embedding', 'text_embedding', 'sparse_embedding'} if task == 'embedding' else {'rerank'}
    choices = [e['inference_id'] for e in endpoints if e.get('task_type') in types]
    if requested:
        if requested not in choices:
            raise ValueError('requested inference endpoint does not exist with compatible task')
        return requested
    if not choices:
        raise ValueError('no compatible existing inference endpoint; configure one separately')
    return sorted(choices, key=lambda identifier: ('jina' not in identifier.lower(), identifier))[0]


def schemas(inference_id):
    text = lambda: dict(type='text', copy_to='semantic_text', search_analyzer='overflow_search')
    properties = {key: {'type': 'keyword'} for key in ('id', 'room', 'floor', 'capacity_source', 'tags', 'track', 'level', 'source_url')}
    properties.update(title=text(), abstract=text(), speakers=text(), start={'type': 'date'}, end={'type': 'date'},
                      capacity={'type': 'integer'}, synthetic={'type': 'boolean'}, semantic_text={'type': 'semantic_text', 'inference_id': inference_id})
    analysis = {'filter': {'overflow_synonyms': {'type': 'synonym_graph', 'synonyms_set': 'overflow-synonyms', 'updateable': True}},
                'analyzer': {'overflow_search': {'type': 'custom', 'tokenizer': 'standard', 'filter': ['lowercase', 'overflow_synonyms']}}}
    return {
        'talks': {'settings': {'analysis': analysis}, 'mappings': {'properties': properties}},
        'interactions': {'mappings': {'properties': {'talk_id': {'type': 'keyword'}, 'attendee_id': {'type': 'keyword'},
                         'type': {'type': 'keyword'}, 'timestamp': {'type': 'date'}, 'created_at': {'type': 'date'}}}},
        'talk_alerts': {'mappings': {'properties': {'talk_id': {'type': 'keyword'}, 'attendee_id': {'type': 'keyword'},
                        'query': {'type': 'percolator'}, 'timestamp': {'type': 'date'}, 'created_at': {'type': 'date'}}}},
        'overflow_settings': {'mappings': {'properties': {'mode': {'type': 'keyword'}}}},
    }


def search_body(arm, text, rerank_id=None, filters=None, full_ids=None):
    """Match runtime buildSearch semantics; collector retains only top 10 IDs."""
    from .catalog import utc
    filters = filters or {}
    filter_clauses = []
    if filters.get('day'):
        day = dt.date.fromisoformat(filters['day'])
        filter_clauses.append({'range': {'start': {'gte': utc(day.isoformat() + 'T00:00:00').replace('Z', '.000Z'),
                                                 'lt': utc((day + dt.timedelta(days=1)).isoformat() + 'T00:00:00').replace('Z', '.000Z')}}})
    if filters.get('track'):
        filter_clauses.append({'term': {'track': filters['track']}})
    common = {'filter': filter_clauses}
    if filters.get('available') and full_ids:
        common['must_not'] = [{'terms': {'id': full_ids}}]
    query = {'bool': {'must': [{'multi_match': {'query': text, 'fields': ['title^3', 'abstract', 'speakers^2', 'tags^2', 'track'],
                                               'type': 'best_fields', 'operator': 'and'}}] if text else [{'match_all': {}}], **common}}
    lexical = {'standard': {'query': query}}
    semantic = {'standard': {'query': {'bool': {'must': [{'semantic': {'field': 'semantic_text', 'query': text}}], **common}}}}
    offset = filters.get('offset', 0)
    base = {'size': 100, 'from': offset, 'track_total_hits': True, '_source': {'excludes': ['semantic_text']}}
    if not text:
        return {**base, 'query': query, 'sort': [{'start': 'asc'}, {'id': 'asc'}]}
    hybrid = {'rrf': {'retrievers': [lexical, semantic], 'rank_window_size': 100 + offset, 'rank_constant': 60}}
    if arm == 'bm25':
        return {**base, 'query': query}
    elif arm == 'semantic':
        retriever = semantic
    elif arm == 'hybrid':
        retriever = hybrid
    elif arm == 'hybrid_rerank' and rerank_id:
        retriever = {'text_similarity_reranker': {'retriever': hybrid, 'field': 'abstract', 'inference_id': rerank_id,
                                                'inference_text': text, 'rank_window_size': 20}}
    else:
        raise ValueError('unknown arm or missing verified reranker')
    return {**base, **({'size': 20} if arm == 'hybrid_rerank' else {}), 'retriever': retriever}


def main():
    from .catalog import validate
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', required=True, type=Path)
    parser.add_argument('--catalog', type=Path, default=Path('app/data/catalog.json'))
    parser.add_argument('--inference-id', help='Must exist in GET /_inference')
    parser.add_argument('--apply', action='store_true', help='Create indices/synonyms and upsert catalog; otherwise read-only discovery')
    args = parser.parse_args()
    try:
        catalog = json.loads(args.catalog.read_text())
        count = validate(catalog)
        client = Client(read_env(args.env))
        inference_id = select_inference(client.request('GET', '/_inference'), args.inference_id)
        mappings = schemas(inference_id)
        if not args.apply:
            print(json.dumps({'mode': 'read_only_preview', 'inference_id': inference_id, 'indices': list(mappings), 'talks': count, 'writes': 0}))
            return
        client.request('PUT', '/_synonyms/overflow-synonyms', {'synonyms_set': [{'id': 'kubernetes', 'synonyms': 'k8s, kubernetes'},
                                                                           {'id': 'opentelemetry', 'synonyms': 'otel, opentelemetry'}]})
        for name, schema in mappings.items():
            current = client.request('GET', '/' + name + '/_mapping', allow_404=True)
            if current is None:
                client.request('PUT', '/' + name, schema)
            elif name == 'talks':
                props = current.get(name, {}).get('mappings', {}).get('properties', {})
                if props.get('semantic_text', {}).get('inference_id') != inference_id:
                    raise ValueError('existing talks mapping has incompatible inference endpoint; migration required')
        for offset in range(0, count, 25):
            lines = []
            for talk in catalog['talks'][offset:offset + 25]:
                lines.extend([json.dumps({'index': {'_index': 'talks', '_id': talk['id']}}), json.dumps(talk)])
            response = client.request('POST', '/_bulk?refresh=wait_for', '\n'.join(lines) + '\n', ndjson=True)
            if response.get('errors'):
                raise ElasticError('bulk indexing has failed items; inspect provider privately')
        indexed = client.request('GET', '/talks/_count')['count']
        if indexed != count:
            raise ValueError('indexed count differs from catalog; stale records require explicit migration')
        print(json.dumps({'mode': 'applied', 'inference_id': inference_id, 'indexed_count': indexed, 'catalog_count': count}))
    except (ElasticError, ValueError, OSError, KeyError):
        parser.exit(1, 'Elasticsearch setup failed; no credentials or provider response were emitted. Check connectivity, privilege and mapping compatibility privately.\n')


if __name__ == '__main__':
    main()
