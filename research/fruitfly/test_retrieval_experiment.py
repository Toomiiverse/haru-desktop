import unittest
import numpy as np
from retrieval_experiment import confusion, nudge_metrics, rank_metrics, rewire, unit, winners


class EvaluationChecks(unittest.TestCase):
    def test_rewiring_changes_edges_without_changing_either_degree_sequence(self):
        graph = np.eye(30, dtype=np.float32)
        changed, swaps = rewire(graph, np.random.default_rng(42))
        self.assertGreater(swaps, 0)
        self.assertGreater(np.count_nonzero(changed != graph), 30)
        np.testing.assert_array_equal(changed.sum(0), graph.sum(0))
        np.testing.assert_array_equal(changed.sum(1), graph.sum(1))

    def test_no_false_improvement_from_missing_hybrid_results(self):
        measured = rank_metrics([[], [1, 0]], [0, 0], [[0, 1], [0, 1]], np.array([True, True]))
        self.assertEqual(measured['accuracy_at_1'], 0)
        self.assertEqual(measured['recall_at_5'], 0.5)
        self.assertEqual(measured['mrr_at_5'], 0.25)

    def test_heldout_labels_do_not_change_selected_threshold(self):
        scores = np.array([0.8, 0.2, 0.9, 0.3])
        dev = np.array([True, True, False, False])
        first = nudge_metrics(scores, np.array([True, False, True, False]), dev)
        second = nudge_metrics(scores, np.array([True, False, False, True]), dev)
        self.assertEqual(first['threshold'], second['threshold'])
        self.assertNotEqual(first['heldout'], second['heldout'])

    def test_normalisation_and_identical_vectors_retain_identity(self):
        code = winners(np.array([[1, 2, 3, 4], [1, 2, 3, 4]], dtype=float), 0.5)
        self.assertEqual(int(code.sum()), 4)
        np.testing.assert_allclose(unit(code) @ unit(code).T, np.ones((2, 2)), atol=1e-6)
        self.assertTrue(np.isfinite(unit(np.zeros((1, 4)))).all())

    def test_suppressing_every_message_is_not_high_precision(self):
        result = confusion(np.array([True, True, True, True]), np.array([True, False, False, False]), np.ones(4, dtype=bool))
        self.assertEqual(result['fp'], 3)
        self.assertEqual(result['balanced_accuracy'], 0.5)
        self.assertEqual(result['precision'], 0.25)


if __name__ == '__main__':
    unittest.main()
