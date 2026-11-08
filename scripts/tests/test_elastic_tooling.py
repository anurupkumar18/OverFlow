import importlib
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
        self.assertIn('multi_match', lexical['retriever']['standard']['query'])
        self.assertIn('semantic', tool.search_body('semantic', 'otel')['retriever']['standard']['query'])
        self.assertIn('rrf', tool.search_body('hybrid', 'otel')['retriever'])
        with self.assertRaises(ValueError):
            tool.search_body('hybrid_rerank', 'otel')
        body = tool.search_body('hybrid_rerank', 'otel', 'existing-rerank')
        self.assertEqual(body['retriever']['text_similarity_reranker']['rank_window_size'], 20)

    def test_cleartext_remote_urls_are_rejected_before_secrets_are_sent(self):
        with self.assertRaises(ValueError):
            self.module().Client({'ES_URL': 'http://remote.invalid', 'ES_API_KEY': 'fake'})


if __name__ == '__main__':
    unittest.main()
