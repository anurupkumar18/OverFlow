import copy
import importlib
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


if __name__ == '__main__':
    unittest.main()
