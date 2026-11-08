import importlib
import json
from pathlib import Path
import subprocess
import unittest


class ElasticToolingTests(unittest.TestCase):
    def module(self):
        try:
            return importlib.import_module('scripts.ingest.elastic')
        except ModuleNotFoundError:
            self.fail('Elasticsearch tooling is not implemented')

    def test_discovery_pins_only_existing_compatible_inference(self):
        tool = self.module()
        data = {'endpoints': [{'inference_id': 'chat', 'task_type': 'completion'},
                              {'inference_id': 'jina-real', 'task_type': 'text_embedding'},
                              {'inference_id': 'rerank-real', 'task_type': 'rerank'}]}
        self.assertEqual(tool.select_inference(data), 'jina-real')
        self.assertEqual(tool.select_inference(data, task='rerank'), 'rerank-real')
        with self.assertRaises(ValueError):
            tool.select_inference(data, requested='imaginary')

    def test_schema_keeps_keywords_dates_and_semantic_copy(self):
        tool = self.module()
        schema = tool.schemas('existing-model')['talks']
        props = schema['mappings']['properties']
        self.assertEqual(props['start']['type'], 'date')
        self.assertEqual(props['id']['type'], 'keyword')
        self.assertEqual(props['title']['copy_to'], 'semantic_text')
        self.assertEqual(props['semantic_text']['inference_id'], 'existing-model')

    def test_search_bodies_keep_four_distinct_arms_and_require_real_reranker(self):
        tool = self.module()
        lexical = tool.search_body('bm25', 'otel')
        self.assertEqual(lexical['query']['bool']['must'][0]['multi_match']['operator'], 'and')
        self.assertIn('semantic', tool.search_body('semantic', 'otel')['retriever']['standard']['query']['bool']['must'][0])
        self.assertIn('rrf', tool.search_body('hybrid', 'otel')['retriever'])
        with self.assertRaises(ValueError):
            tool.search_body('hybrid_rerank', 'otel')
        body = tool.search_body('hybrid_rerank', 'otel', 'existing-rerank')
        self.assertEqual(body['retriever']['text_similarity_reranker']['rank_window_size'], 20)

    def test_cleartext_remote_urls_are_rejected_before_secrets_are_sent(self):
        with self.assertRaises(ValueError):
            self.module().Client({'ES_URL': 'http://remote.invalid', 'ES_API_KEY': 'fake'})

    def test_eval_requests_match_runtime_retrieval_semantics(self):
        tool = self.module()
        root = Path(__file__).resolve().parents[2]
        for filters, full_ids in [({'q': 'otel production'}, []),
                                  ({'q': 'otel production', 'day': '2026-11-10', 'track': 'Observability', 'available': True}, ['full'])]:
            script = "const fs=require('node:fs');const {Elasticsearch}=require('./app/src/elasticsearch');const x=JSON.parse(fs.readFileSync(0,'utf8'));const engine=new Elasticsearch({env:{ES_URL:'https://example.invalid',ES_RERANK_INFERENCE_ID:'existing-rerank'}});console.log(JSON.stringify(Object.fromEntries(['bm25','hybrid','hybrid_rerank'].map(mode=>[mode,engine.buildSearch(mode,x.filters,x.full_ids)]))));"
            response = subprocess.run(['node', '-e', script], input=json.dumps(dict(filters=filters, full_ids=full_ids)), cwd=root,
                                      capture_output=True, text=True, check=True)
            runtime = json.loads(response.stdout)
            for arm, expected in runtime.items():
                self.assertEqual(tool.search_body(arm, filters['q'], 'existing-rerank', filters=filters, full_ids=full_ids), expected, arm)


if __name__ == '__main__':
    unittest.main()
