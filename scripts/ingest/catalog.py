"""Public Sessionize normalization. No third-party dependencies or raw-page output."""
import argparse
import collections
import copy
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import urllib.request
import urllib.error
from zoneinfo import ZoneInfo

API = 'https://sessionize.com/api/v2/svi82w6c/view/All'
PAGE = 'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/'
DENVER = ZoneInfo('America/Denver')
LANDSCAPE = 'https://landscape.cncf.io/api/projects/all.json'
LANDSCAPE_SCHEMA = 'https://github.com/cncf/landscape2/blob/main/crates/cli/src/build/api.rs'
MAX_DERIVED_PROJECTS = 6
# Deliberate precision tradeoff: ordinary words are not reliable project evidence.
AMBIGUOUS_PROJECT_NAMES = frozenset(name.casefold() for name in (
    'Armada', 'Atlantis', 'Backstage', 'Capsule', 'Carina', 'Cartography', 'Cedar',
    'Contour', 'Cortex', 'Distribution', 'Dragonfly', 'Envoy', 'Eraser', 'Fluid',
    'Harbor', 'Headlamp', 'Interlink', 'Kepler', 'Litmus', 'Longhorn', 'Pixie',
    'Porter', 'Praxis', 'Radius', 'Score', 'Spin', 'Stacker', 'Submariner', 'Tremor',
    'Trickster', 'Volcano'))


def utc(value):
    if not isinstance(value, str):
        raise ValueError('source timestamp must be a string')
    moment = dt.datetime.fromisoformat(value)
    if moment.tzinfo is None:
        first = moment.replace(tzinfo=DENVER, fold=0)
        second = moment.replace(tzinfo=DENVER, fold=1)
        if first.utcoffset() != second.utcoffset():
            raise ValueError('ambiguous or nonexistent Denver source timestamp')
        moment = first
    return moment.astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def validate(catalog):
    if not isinstance(catalog, dict) or not isinstance(catalog.get('talks'), list):
        raise ValueError('catalog must contain a talks array')
    seen, rooms = set(), collections.defaultdict(list)
    for talk in catalog['talks']:
        if not isinstance(talk, dict):
            raise ValueError('talk must be an object')
        for field in ('id', 'title', 'abstract', 'room', 'start', 'end'):
            if not isinstance(talk.get(field), str) or not talk[field].strip():
                raise ValueError('missing or malformed talk field: ' + field)
        if talk['id'] in seen:
            raise ValueError('duplicate talk id: ' + talk['id'])
        seen.add(talk['id'])
        if not isinstance(talk.get('speakers'), list) or not talk['speakers'] or any(not isinstance(s, str) or not s for s in talk['speakers']):
            raise ValueError('talk requires speaker names')
        try:
            if not all(talk[k].endswith('Z') for k in ('start', 'end')):
                raise ValueError('timestamps must use UTC Z')
            start, end = (dt.datetime.fromisoformat(talk[k]) for k in ('start', 'end'))
        except (TypeError, ValueError) as error:
            raise ValueError('invalid UTC timestamps for ' + talk['id']) from error
        if start >= end:
            raise ValueError('start must precede end: ' + talk['id'])
        capacity = talk.get('capacity')
        if capacity is not None and (isinstance(capacity, bool) or not isinstance(capacity, (float, int)) or not math.isfinite(capacity) or capacity <= 0):
            raise ValueError('capacity must be a positive estimate or null')
        if talk.get('capacity_source') != 'estimate':
            raise ValueError('capacity_source must disclose estimate')
        rooms[talk['room']].append((start, end, talk['id']))
    for entries in rooms.values():
        entries.sort()
        for previous, current in zip(entries, entries[1:]):
            if current[0] < previous[1]:
                raise ValueError('room overlap: ' + previous[2] + ', ' + current[2])
    return len(seen)


def normalize(raw, capacity=200, retrieved_at=None, raw_sha256=None):
    if not isinstance(raw, dict) or any(not isinstance(raw.get(k), list) for k in ('sessions', 'speakers', 'rooms', 'categories')):
        raise ValueError('invalid Sessionize envelope')
    speakers = {s['id']: s['fullName'] for s in raw['speakers']}
    rooms = {r['id']: r['name'] for r in raw['rooms']}
    categories = {i['id']: (c['title'], i['name']) for c in raw['categories'] for i in c['items']}
    talks, candidates, posters = [], 0, 0
    source_ids = set()
    for session in raw['sessions']:
        if not isinstance(session, dict):
            raise ValueError('source session must be an object')
        identifier = str(session.get('id', ''))
        if not identifier or identifier in source_ids:
            raise ValueError('missing or duplicate source id: ' + identifier)
        source_ids.add(identifier)
        if not all(session.get(k) for k in ('speakers', 'description', 'startsAt', 'endsAt', 'roomId')):
            continue
        candidates += 1
        if not isinstance(session.get('title'), str) or not session['title'].strip() or not isinstance(session['description'], str) or not isinstance(session['speakers'], list):
            raise ValueError('malformed source title, description or speakers')
        groups = collections.defaultdict(list)
        for item in session.get('categoryItems', []):
            if item in categories:
                group, name = categories[item]
                groups[group].append(name)
        if '🪧 Poster Sessions' in groups['All Sessions']:
            posters += 1
            continue
        try:
            names = [speakers[s] for s in session['speakers']]
        except KeyError as error:
            raise ValueError('unresolved speaker reference: ' + identifier) from error
        if session['roomId'] not in rooms:
            raise ValueError('unresolved room reference: ' + identifier)
        room = rooms[session['roomId']]
        floor = re.search(r'\bLevel \d+\b', room)
        talks.append(dict(id=identifier, title=session['title'].strip(), abstract=session['description'].strip(),
                          speakers=names, start=utc(session['startsAt']), end=utc(session['endsAt']), room=room,
                          floor=floor.group() if floor else None, capacity=capacity, capacity_source='estimate',
                          tags=list(dict.fromkeys(groups['CNCF Projects'] + groups['SubTopic'])),
                          track=', '.join(groups['All Sessions']), level=', '.join(groups['Audience Level']) or 'Unspecified',
                          source_url=PAGE + '?id=' + identifier, synthetic=False))
    talks.sort(key=lambda t: (t['start'], t['room'], t['id']))
    result = {'source': dict(name='KubeCon + CloudNativeCon North America 2026 official public schedule', url=PAGE,
                            api_url=API, retrieved_at=retrieved_at or dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z'),
                            source_updated_at=None, timezone='America/Denver', raw_sha256=raw_sha256,
                            raw_session_count=len(raw['sessions']), speaker_and_abstract_candidate_count=candidates,
                            excluded_poster_count=posters, talk_count=len(talks), overlapping_room_pair_count=0,
                            selection='Speaker, abstract, room and timestamps required. Poster sessions excluded because they share a hall concurrently. Includes theater talks and scheduled experiences.',
                            time_interpretation='Naive source timestamps use America/Denver; official schedule states MST (UTC-7). Converted to UTC Z.',
                            capacity_policy='Uniform 200-person demonstration planning estimate, not venue data.' if capacity == 200 else 'Explicit uniform planning estimate, not venue data.',
                            synthetic=False), 'talks': talks}
    validate(result)
    return result


def enrich_landscape(catalog, body, retrieved_at=None):
    """Append bounded exact project-name mentions; never infer affiliation/relevance."""
    validate(catalog)
    if not isinstance(body, bytes) or not body or len(body) > 5_000_000:
        raise ValueError('missing or oversized landscape project source')
    try:
        rows = json.loads(body)
    except (ValueError, UnicodeError) as error:
        raise ValueError('invalid landscape project JSON') from error
    if not isinstance(rows, list) or not rows or len(rows) > 2000:
        raise ValueError('landscape project source requires a nonempty bounded array')
    projects, seen = [], set()
    for row in rows:
        if not isinstance(row, dict) or any(not isinstance(row.get(key), str) or not row[key].strip() for key in ('id', 'name')):
            raise ValueError('landscape project record requires id and name')
        identifier, name = row['id'], row['name']
        if identifier in seen:
            raise ValueError('duplicate landscape project id')
        seen.add(identifier)
        if (row.get('maturity') not in ('graduated', 'incubating', 'sandbox') or row.get('archived_at')
                or row.get('oss') is not True or len(name) < 5 or name.casefold() in AMBIGUOUS_PROJECT_NAMES):
            continue
        projects.append((name, identifier, re.compile(r'(?<!\w)' + re.escape(name.casefold()) + r'(?!\w)')))
    if not projects:
        raise ValueError('landscape source contains no eligible unambiguous active project names')
    result = copy.deepcopy(catalog)
    digest = hashlib.sha256(body).hexdigest()
    prior = result.get('source', {}).get('landscape', {})
    observed_at = (retrieved_at or (prior.get('retrieved_at') if prior.get('raw_sha256') == digest else None)
                   or dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z'))
    if not isinstance(observed_at, str) or not observed_at.endswith('Z'):
        raise ValueError('landscape retrieval timestamp must use UTC Z')
    dt.datetime.fromisoformat(observed_at)
    added, matched_sessions = 0, 0
    for talk in result['talks']:
        # Remove only tags previously added by this enrichment; original schedule tags survive.
        previous_added = {mention['name'] for mention in talk.get('derived_project_mentions', []) if mention.get('added_to_tags')}
        tags = [tag for tag in talk.get('tags', []) if tag not in previous_added]
        existing = {tag.casefold() for tag in tags}
        title, abstract = talk['title'].casefold(), talk['abstract'].casefold()
        matches = []
        for name, identifier, pattern in projects:
            title_match, abstract_match = pattern.search(title), pattern.search(abstract)
            if title_match or abstract_match:
                position = (0, title_match.start()) if title_match else (1, abstract_match.start())
                matches.append((position, name.casefold(), name, identifier, title_match is not None, abstract_match is not None))
        mentions = []
        for _, _, name, identifier, in_title, in_abstract in sorted(matches)[:MAX_DERIVED_PROJECTS]:
            is_new = name.casefold() not in existing
            if is_new:
                tags.append(name)
                existing.add(name.casefold())
                added += 1
            mentions.append(dict(name=name, project_id=identifier, source_url='https://landscape.cncf.io/api/projects/' + identifier + '.json',
                                 method='derived_exact_whole_name_mention', matched_fields=[field for field, found in [('title', in_title), ('abstract', in_abstract)] if found],
                                 added_to_tags=is_new))
        talk['tags'], talk['derived_project_mentions'] = tags, mentions
        matched_sessions += bool(mentions)
    result['source']['landscape'] = dict(status='enriched', url=LANDSCAPE, schema_url=LANDSCAPE_SCHEMA, raw_sha256=digest,
                                       retrieved_at=observed_at, source_updated_at=None, source_project_records=len(rows),
                                       eligible_project_names=len(projects), matched_sessions=matched_sessions, added_tags=added,
                                       method='derived_exact_whole_name_mention', maximum_mentions_per_talk=MAX_DERIVED_PROJECTS,
                                       matching_policy='Case-insensitive exact whole official name in title/abstract; title matches first. Active open-source projects only. Names shorter than 5 characters and explicit ambiguous ordinary-word names skipped. No aliases, fuzzy matches, vendor/category inference, affiliation or human relevance labels.',
                                       excluded_ambiguous_names=sorted(AMBIGUOUS_PROJECT_NAMES))
    validate(result)
    return result


def fetch_public(url, bound):
    request = urllib.request.Request(url, headers={'User-Agent': 'Overflow public catalog ingest/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(bound + 1)
    if len(body) > bound:
        raise ValueError('public source exceeds response size bound')
    return body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, help='Offline Sessionize JSON fixture; raw input is never copied into repo')
    parser.add_argument('--validate', type=Path, help='Validate an existing normalized catalog and exit')
    parser.add_argument('--enrich-catalog', type=Path, help='Enrich an existing catalog without refreshing schedule records')
    parser.add_argument('--landscape-input', type=Path, help='Offline official projects/all.json snapshot; raw data is never copied')
    parser.add_argument('--landscape-retrieved-at', help='Recorded UTC Z retrieval time for byte-reproducible offline replay')
    parser.add_argument('--schedule-retrieved-at', help='Recorded UTC Z retrieval time when replaying offline schedule input')
    parser.add_argument('--skip-landscape', action='store_true', help='Explicitly omit derived project enrichment')
    parser.add_argument('--output', type=Path, default=Path('app/data/catalog.json'))
    parser.add_argument('--capacity-estimate', type=int, default=200)
    args = parser.parse_args()
    if args.validate:
        print(json.dumps({'valid_talks': validate(json.loads(args.validate.read_text()))}))
        return
    if args.enrich_catalog:
        if args.input:
            parser.error('--enrich-catalog and --input cannot be combined')
        result = json.loads(args.enrich_catalog.read_text())
        validate(result)
    else:
        body = args.input.read_bytes() if args.input else fetch_public(API, 10_000_000)
        result = normalize(json.loads(body), args.capacity_estimate, retrieved_at=args.schedule_retrieved_at,
                           raw_sha256=hashlib.sha256(body).hexdigest())
    if args.landscape_input:
        result = enrich_landscape(result, args.landscape_input.read_bytes(), args.landscape_retrieved_at)
    elif not args.skip_landscape and (not args.input or args.enrich_catalog):
        try:
            result = enrich_landscape(result, fetch_public(LANDSCAPE, 5_000_000), args.landscape_retrieved_at)
        except (urllib.error.URLError, TimeoutError, OSError):
            if args.enrich_catalog:
                raise ValueError('landscape unavailable; existing catalog was not replaced') from None
            result['source']['landscape'] = dict(status='unavailable', url=LANDSCAPE, reason='Public source could not be fetched; no derived project tags were added.')
    elif not args.enrich_catalog:
        result['source']['landscape'] = dict(status='not_requested', url=LANDSCAPE, reason='Explicitly skipped or offline schedule supplied without landscape input; no derived project tags were added.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(args.output)
    print(json.dumps({'talks': len(result['talks']), 'output': str(args.output)}))


if __name__ == '__main__':
    main()
