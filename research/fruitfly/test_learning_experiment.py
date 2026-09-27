import unittest
import numpy as np
from learning_experiment import learn, make_case


class LearningChecks(unittest.TestCase):
    def test_missing_feedback_is_not_a_negative_rating(self):
        code = np.eye(2, dtype=np.float32)
        prediction, _ = learn(code, [0, 1, 0, 1], [0, 0, 0, 0], [False] * 4, 0.3)
        np.testing.assert_array_equal(prediction, [0.5, 0.5])

    def test_feedback_can_be_learned_and_reversed_without_touching_unseen_context(self):
        code = np.eye(2, dtype=np.float32)
        prediction, _ = learn(code, [0] * 20, [1] * 20, [True] * 20, 0.3)
        self.assertGreater(prediction[0], 0.99)
        self.assertEqual(prediction[1], 0.5)
        prediction, _ = learn(code, [0] * 40, [1] * 20 + [0] * 20, [True] * 40, 0.3)
        self.assertLess(prediction[0], 0.01)
        self.assertEqual(prediction[1], 0.5)

    def test_heldout_contexts_never_appear_in_feedback(self):
        case = make_case(204, 'reversal')
        self.assertEqual(set(case['contexts']) & set(case['held']), set())
        self.assertEqual(len(set(case['seen']) | set(case['held'])), 32)
        self.assertTrue(np.array_equal(case['observed'], make_case(204, 'reversal')['observed']))


if __name__ == '__main__':
    unittest.main()
