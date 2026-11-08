import copy
import importlib
import hashlib
import json
import unittest


def fixture():
    return {
        'sessions': [{'id': 'a', 'title': 'A real title', 'description': 'Abstract',
                      'startsAt': '2026-11-10T11:30:00', 'endsAt': '2026-11-10T12:00:00',
                      'speakers': ['s'], 'roomId': 1, 'categoryItems': [10, 11]}],
        'speakers': [{'id': 's', 'fullName': 'Speaker Name'}],
        'rooms': [{'id': 1, 'name': 'Hyatt Regency | Level 4 | Regency Ballroom B'}],
        'categories': [{'title': 'All Sessions', 'items': [{'id': 10, 'name': 'Observability'}]},
                       {'title': 'CNCF Projects', 'items': [{'id': 11, 'name': 'OpenTelemetry'}]}],
    }


class IngestTests(unittest.TestCase):
    def module(self):
        try:
            return importlib.import_module('scripts.ingest.catalog')
        except ModuleNotFoundError:
            self.fail('catalog normalization module is not implemented')

    def test_mst_normalization_preserves_real_floor_and_metadata(self):
        talk = self.module().normalize(fixture())['talks'][0]
        self.assertEqual(talk['start'], '2026-11-10T18:30:00Z')
        self.assertEqual(talk['end'], '2026-11-10T19:00:00Z')
        self.assertEqual(talk['floor'], 'Level 4')
        self.assertEqual(talk['speakers'], ['Speaker Name'])
        self.assertEqual(talk['tags'], ['OpenTelemetry'])
        self.assertEqual(talk['capacity_source'], 'estimate')
        self.assertFalse(talk['synthetic'])

    def test_invalid_source_reference_is_rejected(self):
        raw = fixture()
        raw['sessions'][0]['speakers'] = ['missing']
        with self.assertRaisesRegex(ValueError, 'speaker'):
            self.module().normalize(raw)

    def test_duplicate_and_same_room_overlap_are_rejected(self):
        module = self.module()
        raw = fixture()
        raw['sessions'].append(copy.deepcopy(raw['sessions'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            module.normalize(raw)
        raw['sessions'][1]['id'] = 'b'
        with self.assertRaisesRegex(ValueError, 'overlap'):
            module.normalize(raw)
        raw['sessions'][1]['startsAt'] = '2026-11-10T12:00:00'
        raw['sessions'][1]['endsAt'] = '2026-11-10T12:30:00'
        self.assertEqual(len(module.normalize(raw)['talks']), 2)

    def test_malformed_and_non_utc_catalog_times_are_rejected(self):
        module = self.module()
        raw = fixture()
        raw['sessions'][0]['startsAt'] = 'tomorrow'
        with self.assertRaises(ValueError):
            module.normalize(raw)
        catalog = module.normalize(fixture())
        catalog['talks'][0]['start'] = '2026-11-10T18:30:00'
        with self.assertRaisesRegex(ValueError, 'UTC'):
            module.validate(catalog)

    def test_poster_sessions_are_excluded_before_room_validation(self):
        raw = fixture()
        raw['categories'][0]['items'].append({'id': 12, 'name': '🪧 Poster Sessions'})
        poster = copy.deepcopy(raw['sessions'][0])
        poster.update(id='poster', categoryItems=[12])
        raw['sessions'].append(poster)
        self.assertEqual(len(self.module().normalize(raw)['talks']), 1)

    def test_ambiguous_dst_source_time_is_rejected(self):
        raw = fixture()
        raw['sessions'][0]['startsAt'] = '2026-11-01T01:30:00'
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            self.module().normalize(raw)

    def test_missing_title_and_malformed_envelope_are_rejected_cleanly(self):
        module = self.module()
        raw = fixture()
        raw['sessions'][0]['title'] = None
        with self.assertRaises(ValueError):
            module.normalize(raw)
        for malformed in [[], {'sessions': []}, dict(fixture(), sessions=[None])]:
            with self.assertRaises(ValueError):
                module.normalize(malformed)

    def test_landscape_exact_mentions_preserve_tags_and_trace_project_source(self):
        module = self.module()
        catalog = module.normalize(fixture())
        catalog['talks'][0]['title'] = 'OpenTelemetry with Linkerd'
        catalog['talks'][0]['abstract'] = 'Linkerd and OpenTelemetry operate with Kubernetes.'
        rows = [dict(id=name.lower(), name=name, maturity='graduated', oss=True)
                for name in ['Kubernetes', 'Linkerd', 'OpenTelemetry']]
        body = json.dumps(rows).encode()
        enriched = module.enrich_landscape(catalog, body, retrieved_at='2026-11-08T22:00:00Z')
        talk = enriched['talks'][0]
        self.assertEqual(talk['tags'], ['OpenTelemetry', 'Linkerd', 'Kubernetes'])
        self.assertEqual(talk['derived_project_mentions'][0]['name'], 'OpenTelemetry')
        self.assertEqual(talk['derived_project_mentions'][0]['method'], 'derived_exact_whole_name_mention')
        self.assertEqual(enriched['source']['landscape']['raw_sha256'], hashlib.sha256(body).hexdigest())
        self.assertEqual(enriched['source']['landscape']['url'], 'https://landscape.cncf.io/api/projects/all.json')
        self.assertEqual(talk['start'], catalog['talks'][0]['start'])
        self.assertEqual(talk['capacity'], catalog['talks'][0]['capacity'])
        self.assertNotIn('derived_project_mentions', catalog['talks'][0])
        self.assertEqual(enriched, module.enrich_landscape(enriched, body))

    def test_landscape_ignores_partial_ambiguous_short_archived_and_vendor_names(self):
        module = self.module()
        catalog = module.normalize(fixture())
        catalog['talks'][0].update(title='OpenTelemetryCollector in a harbor', abstract='Helm, Flux, Score, Radius, Acme Vendor, OldProject and KEDA; myLinkerdish is no project mention.')
        rows = [dict(id=name.lower(), name=name, maturity='graduated', oss=True)
                for name in ['OpenTelemetry', 'Linkerd', 'Harbor', 'Helm', 'Flux', 'Score', 'Radius', 'KEDA']]
        rows += [dict(id='old', name='OldProject', maturity='archived', oss=True),
                 dict(id='vendor', name='Acme Vendor', oss=False)]
        talk = module.enrich_landscape(catalog, json.dumps(rows).encode())['talks'][0]
        self.assertEqual(talk['tags'], ['OpenTelemetry'])
        self.assertEqual(talk['derived_project_mentions'], [])

    def test_landscape_limits_added_tags_and_rejects_missing_or_malformed_source(self):
        module = self.module()
        catalog = module.normalize(fixture())
        names = ['Project' + str(i) for i in range(12)]
        catalog['talks'][0]['abstract'] = ', '.join(names)
        body = json.dumps([dict(id=name.lower(), name=name, maturity='sandbox', oss=True) for name in names]).encode()
        talk = module.enrich_landscape(catalog, body)['talks'][0]
        self.assertEqual(len(talk['derived_project_mentions']), 6)
        self.assertEqual(len(talk['tags']), 7)
        for bad in [None, b'{}', b'[]', b'not json', b'[{"name":"Linkerd","maturity":"graduated"}]']:
            with self.assertRaises(ValueError):
                module.enrich_landscape(catalog, bad)


if __name__ == '__main__':
    unittest.main()
