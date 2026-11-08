"""CI uses fresh provider results, never a stale committed score as proof."""
import importlib
import unittest


class Provider:
    def __init__(self):
        self.calls = []
        self.reverse = False
        self.drift = False
        self.corpus_reads = 0

    def request(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path == '/_inference':
            return {'endpoints': [{'inference_id': 'fixture-rerank', 'task_type': 'rerank'}]}
        if path == '/talks/_search':
            corpus = body.get('size') == 1000
            if corpus:
                self.corpus_reads += 1
            ids = ['b', 'a'] if self.reverse and not corpus else ['a', 'b']
            title = 'changed' if self.drift and self.corpus_reads > 1 else 'fixture'
            return {'timed_out': False, '_shards': {'total': 1, 'successful': 1, 'failed': 0},
                    'hits': {'total': {'value': 2, 'relation': 'eq'},
                             'hits': [{'_id': item, '_source': {'id': item, 'title': title}} for item in ids]}}
        if path == '/talks/_mapping':
            return {'talks': {'mappings': {'properties': {}}}}
        if path.startswith('/talks/_settings'):
            return {'talks': {'settings': {}}}
        if path == '/_synonyms/overflow-synonyms':
            return {'synonyms_set': []}
        raise AssertionError(path)


class CIEvaluationTests(unittest.TestCase):
    queries = [{'id': 'fixture', 'text': 'approved test fixture'}]
    catalog = {'talks': [{'id': 'a', 'title': 'fixture'}, {'id': 'b', 'title': 'fixture'}]}
    labels = [{'query_id': 'fixture', 'talk_id': 'a', 'label': '1', 'label_source': 'human'},
              {'query_id': 'fixture', 'talk_id': 'b', 'label': '0', 'label_source': 'human'}]

    def module(self):
        try:
            return importlib.import_module('eval.ci')
        except ModuleNotFoundError:
            self.fail('A fresh provider CI evaluation is not implemented')

    def baseline(self):
        # Test-only prior measured result; never copied into release artifacts.
        from eval.pool import collect, provider_evidence
        from eval.core import evaluate
        provider = Provider()
        payload = collect(self.queries, provider, 'fixture-rerank')
        payload.update(provider_evidence(provider, 'fixture-rerank', provider.request('GET', '/_inference')))
        report = evaluate(payload, self.labels)
        return {'approved': True, 'label_source': 'human', 'arm': 'hybrid', 'n': 1, 'mrr': 1.0,
                'eligible_query_ids': ['fixture'], 'evidence': report['evidence']}

    def test_missing_human_evidence_is_not_a_pass_and_makes_no_requests(self):
        provider = Provider()
        result = self.module().run_live_gate([], [], None, provider)
        self.assertEqual(result['gate']['status'], 'not_evaluated')
        self.assertEqual(provider.calls, [])

    def test_fresh_requests_can_fail_a_previously_passing_baseline(self):
        provider = Provider()
        provider.reverse = True
        result = self.module().run_live_gate(self.queries, self.labels, self.baseline(), provider, catalog=self.catalog)
        self.assertEqual(result['gate']['status'], 'failed')
        self.assertEqual(result['gate']['measured_mrr'], .5)
        self.assertEqual(len([call for call in provider.calls if call[1] == '/talks/_search']), 6)
        self.assertTrue(all(run['status'] == 'ok' for run in result['runs']['runs']))

    def test_complete_fresh_matching_evidence_passes(self):
        result = self.module().run_live_gate(self.queries, self.labels, self.baseline(), Provider(), catalog=self.catalog)
        self.assertEqual(result['gate']['status'], 'passed')
        self.assertEqual(result['gate']['n'], 1)
        self.assertIsNotNone(result['runs']['measured_at'])

    def test_provider_drift_refuses_a_regression_verdict(self):
        provider = Provider()
        provider.drift = True
        result = self.module().run_live_gate(self.queries, self.labels, self.baseline(), provider, catalog=self.catalog)
        self.assertEqual(result['gate']['status'], 'not_evaluated')
        self.assertIsNone(result['report']['evidence']['corpus_sha256'])

    def test_old_index_cannot_validate_a_changed_checkout_catalog(self):
        candidate = {'talks': [{'id': 'a', 'title': 'Proposed new title'}, {'id': 'b', 'title': 'fixture'}]}
        provider = Provider()
        result = self.module().run_live_gate(self.queries, self.labels, self.baseline(), provider, catalog=candidate)
        self.assertEqual(result['gate']['status'], 'not_evaluated')
        self.assertIn('checked-out catalog', result['gate']['reason'])
        self.assertIsNone(result['report'])
        self.assertTrue(all(method in ('GET', 'POST') and path != '/_bulk' for method,path,_ in provider.calls))


if __name__ == '__main__':
    unittest.main()
