import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


def runs():
    return {'queries': [{'id': 'q1', 'text': 'find a talk'}, {'id': 'q2', 'text': 'unfinished'}],
            'runs': [{'query_id': q, 'arm': arm, 'ids': ['b', 'a', 'c'],
                      'elapsed_ms': ms, 'status': 'ok'}
                     for q in ('q1', 'q2')
                     for arm, ms in [('bm25', 20), ('semantic', 30), ('hybrid', 40), ('hybrid_rerank', 50)]]}


class EvaluationTests(unittest.TestCase):
    def module(self):
        try:
            return importlib.import_module('eval.core')
        except ModuleNotFoundError:
            self.fail('evaluation module is not implemented')

    def test_pool_is_blind_deduplicated_grouped_and_reproducible(self):
        core = self.module()
        rows = core.pool_rows(runs(), {'a': {'title': 'A'}, 'b': {'title': 'B'}, 'c': {'title': 'C'}})
        self.assertEqual(rows, core.pool_rows(runs(), {'a': {'title': 'A'}, 'b': {'title': 'B'}, 'c': {'title': 'C'}}))
        self.assertEqual(len(rows), 6)
        self.assertEqual([r['query_id'] for r in rows], ['q1'] * 3 + ['q2'] * 3)
        self.assertTrue(all('arm' not in row and row['label'] == '' for row in rows))

    def test_partial_query_is_excluded_without_turning_unknown_into_zero(self):
        core = self.module()
        rows = [{'query_id': q, 'talk_id': t, 'label': label, 'label_source': 'human'}
                for q, t, label in [('q1', 'a', '2'), ('q1', 'b', '0'), ('q1', 'c', '1'),
                                    ('q2', 'a', '1'), ('q2', 'b', ''), ('q2', 'c', '')]]
        report = core.evaluate(runs(), rows)
        self.assertEqual(report['n'], 1)
        self.assertEqual(report['excluded_incomplete'], ['q2'])
        self.assertAlmostEqual(report['arms']['bm25']['mrr'], .5)
        self.assertEqual(report['arms']['bm25']['recall_at_10'], 1)
        self.assertEqual(report['arms']['bm25']['p95_ms'], 20)

    def test_empty_labels_produce_not_measured_and_no_scores(self):
        report = self.module().evaluate(runs(), [])
        self.assertEqual(report['n'], 0)
        self.assertIsNone(report['arms']['hybrid']['mrr'])

    def test_invalid_synthetic_or_duplicate_labels_are_rejected(self):
        core = self.module()
        for row in [dict(query_id='q1', talk_id='a', label='yes', label_source='human'),
                    dict(query_id='q1', talk_id='a', label='1', label_source='synthetic')]:
            with self.assertRaises(ValueError):
                core.evaluate(runs(), [row])
        row = dict(query_id='q1', talk_id='a', label='1', label_source='human')
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            core.evaluate(runs(), [row, row])

    def test_failed_arm_excludes_query_from_comparison(self):
        payload = runs()
        payload['runs'][0]['status'] = 'error'
        labels = [dict(query_id='q1', talk_id=t, label='1', label_source='human') for t in ['a', 'b', 'c']]
        report = self.module().evaluate(payload, labels)
        self.assertEqual(report['n'], 0)
        self.assertEqual(report['excluded_failed'], ['q1'])

    def test_rank_ten_and_no_relevant_queries_are_accounted_separately(self):
        payload = runs()
        for row in payload['runs']:
            if row['query_id'] == 'q1':
                row['ids'] = ['z'] * 9 + ['a']
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.module().evaluate(payload, [])

    def test_unknown_top_ten_results_keep_true_ranks_and_are_counted(self):
        payload = runs()
        for row in payload['runs']:
            row['ids'] = ['b', 'a', 'c', 'd', 'e', 'unknown']
        labels = [dict(query_id='q1', talk_id=t, label='1' if t == 'a' else '0', label_source='human')
                  for t in ['a', 'b', 'c', 'd', 'e']]
        report = self.module().evaluate(payload, labels)
        self.assertEqual(report['n'], 1)
        self.assertEqual(report['arms']['hybrid']['mrr'], .5)
        self.assertEqual(report['arms']['hybrid']['unjudged_results_at_10'], 1)

    def test_unjudged_no_relevant_and_failed_pools_are_distinct(self):
        labels = [dict(query_id='q1', talk_id=t, label='0', label_source='human') for t in ['a', 'b', 'c']]
        report = self.module().evaluate(runs(), labels)
        self.assertEqual(report['excluded_no_relevant'], ['q1'])
        self.assertEqual(report['excluded_incomplete'], ['q2'])
        self.assertEqual(report['n'], 0)

    def test_gate_is_not_evaluated_without_human_labels_or_baseline(self):
        try:
            gate = importlib.import_module('eval.gate')
        except ModuleNotFoundError:
            self.fail('honest evaluation gate is not implemented')
        self.assertEqual(gate.check(self.module().evaluate(runs(), []), None)['status'], 'not_evaluated')
        baseline = dict(arm='hybrid', mrr=.7, n=5, label_source='human', approved=True)
        self.assertEqual(gate.check(self.module().evaluate(runs(), []), baseline)['status'], 'not_evaluated')

    def test_gate_compares_only_real_nonempty_human_results(self):
        try:
            gate = importlib.import_module('eval.gate')
        except ModuleNotFoundError:
            self.fail('honest evaluation gate is not implemented')
        labels = [dict(query_id='q1', talk_id=t, label='1' if t == 'a' else '0', label_source='human') for t in ['a', 'b', 'c']]
        payload = runs()
        payload.update(corpus_sha256='a' * 64, ranking_config_sha256='b' * 64)
        report = self.module().evaluate(payload, labels)
        baseline = dict(arm='hybrid', mrr=.6, n=1, label_source='human', approved=True,
                        eligible_query_ids=report['eligible_query_ids'], evidence=report.get('evidence'))
        self.assertEqual(gate.check(report, baseline)['status'], 'failed')
        baseline['mrr'] = .5
        self.assertEqual(gate.check(report, baseline)['status'], 'passed')

    def test_gate_refuses_incomparable_query_labels_corpus_and_ranking(self):
        gate = importlib.import_module('eval.gate')
        payload = runs()
        payload.update(corpus_sha256='a' * 64, ranking_config_sha256='b' * 64)
        labels = [dict(query_id='q1', talk_id=t, label='1' if t == 'a' else '0', label_source='human') for t in ['a', 'b', 'c']]
        report = self.module().evaluate(payload, labels)
        baseline = dict(arm='hybrid', mrr=.5, n=1, label_source='human', approved=True,
                        eligible_query_ids=report['eligible_query_ids'], evidence=report.get('evidence'))
        import copy
        for field in ['queries_sha256', 'labels_sha256', 'corpus_sha256', 'ranking_config_sha256']:
            mismatched = copy.deepcopy(baseline)
            mismatched['evidence'] = dict(mismatched.get('evidence') or {}, **{field: 'c' * 64})
            self.assertEqual(gate.check(report, mismatched)['status'], 'not_evaluated', field)
        mismatched = dict(baseline, n=99, eligible_query_ids=['q-old'])
        self.assertEqual(gate.check(report, mismatched)['status'], 'not_evaluated')
        missing = dict(baseline)
        missing.pop('evidence')
        self.assertEqual(gate.check(report, missing)['status'], 'not_evaluated')

    def test_p95_uses_nearest_rank_on_eligible_query_samples(self):
        payload = dict(queries=[dict(id='q' + str(i), text='approved fixture') for i in range(20)], runs=[])
        labels = []
        for i, query in enumerate(payload['queries']):
            labels.append(dict(query_id=query['id'], talk_id='a', label='1', label_source='human'))
            for arm in ['bm25', 'semantic', 'hybrid', 'hybrid_rerank']:
                payload['runs'].append(dict(query_id=query['id'], arm=arm, status='ok', ids=['a'], elapsed_ms=999 if i == 19 else i + 1))
        report = self.module().evaluate(payload, labels)
        self.assertEqual(report['n'], 20)
        self.assertEqual(report['arms']['bm25']['p95_ms'], 19)

    def test_malformed_run_ids_are_rejected_cleanly(self):
        payload = runs()
        payload['runs'][0]['ids'] = None
        with self.assertRaises(ValueError):
            self.module().evaluate(payload, [])

    def test_cli_gate_rejects_saved_runs_for_unapproved_queries(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / 'queries.json').write_text('[]')
            (folder / 'runs.json').write_text(json.dumps(runs()))
            (folder / 'labels.csv').write_text('query_id,talk_id,label,label_source\n')
            result = subprocess.run([sys.executable, str(root / 'eval/gate.py'), '--queries', str(folder / 'queries.json'),
                                     '--runs', str(folder / 'runs.json'), '--labels', str(folder / 'labels.csv')],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['status'], 'invalid_evidence')

    def test_provider_identity_changes_with_corpus_or_runtime_config(self):
        pool = importlib.import_module('eval.pool')
        class Provider:
            title = 'Actual indexed talk'
            analyzer = 'standard'
            def request(self, method, path, body=None):
                if path == '/talks/_search':
                    return {'hits': {'total': {'value': 1}, 'hits': [{'_id': 'a', '_source': {'id': 'a', 'title': self.title}}]}}
                if path == '/talks/_mapping':
                    return {'talks': {'mappings': {'properties': {'semantic_text': {'inference_id': 'existing-embedding'}}}}}
                if path.startswith('/talks/_settings'):
                    return {'talks': {'settings': {'analysis': self.analyzer}}}
                if path == '/_synonyms/overflow-synonyms':
                    return {'synonyms_set': [{'id': 'k8s', 'synonyms': 'k8s,kubernetes'}]}
                raise AssertionError(path)
        provider = Provider()
        original = pool.provider_evidence(provider, 'reranker', {})
        self.assertEqual(original, pool.provider_evidence(provider, 'reranker', {}))
        provider.title = 'Changed indexed talk'
        self.assertNotEqual(original['corpus_sha256'], pool.provider_evidence(provider, 'reranker', {})['corpus_sha256'])
        provider.analyzer = 'different'
        self.assertNotEqual(original['ranking_config_sha256'], pool.provider_evidence(provider, 'reranker', {})['ranking_config_sha256'])


if __name__ == '__main__':
    unittest.main()
