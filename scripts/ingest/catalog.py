"""Public Sessionize normalization. No third-party dependencies or raw-page output."""
import argparse
import collections
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import urllib.request
from zoneinfo import ZoneInfo

API = 'https://sessionize.com/api/v2/svi82w6c/view/All'
PAGE = 'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/'
DENVER = ZoneInfo('America/Denver')


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, help='Offline Sessionize JSON fixture; raw input is never copied into repo')
    parser.add_argument('--validate', type=Path, help='Validate an existing normalized catalog and exit')
    parser.add_argument('--output', type=Path, default=Path('app/data/catalog.json'))
    parser.add_argument('--capacity-estimate', type=int, default=200)
    args = parser.parse_args()
    if args.validate:
        print(json.dumps({'valid_talks': validate(json.loads(args.validate.read_text()))}))
        return
    if args.input:
        body = args.input.read_bytes()
    else:
        request = urllib.request.Request(API, headers={'User-Agent': 'Overflow schedule ingest/1.0'})
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read(10_000_001)
        if len(body) > 10_000_000:
            raise ValueError('schedule exceeds 10 MB bound')
    result = normalize(json.loads(body), args.capacity_estimate, raw_sha256=hashlib.sha256(body).hexdigest())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(args.output)
    print(json.dumps({'talks': len(result['talks']), 'output': str(args.output)}))


if __name__ == '__main__':
    main()
