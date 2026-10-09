import unittest
import numpy as np
from evaluate_graph_models import accepted, calibrate, metrics, wilson


class EvaluationTests(unittest.TestCase):
    def test_unknown_false_accepts_are_in_mixture_precision(self):
        m = metrics(np.array([[.99, .01], [.02, .98]]), np.array([0, 1]), np.array([[.97, .03]]), .9, .1)
        self.assertEqual(m['known_accepted_precision'], 1.)
        self.assertEqual(m['mixture_precision'], 2 / 3)
        self.assertEqual(m['unknown_false_accepts'], 1)

    def test_margin_rejects_near_ties(self):
        np.testing.assert_array_equal(accepted(np.array([[.51, .49], [.96, .04]]), .5, .05), [False, True])

    def test_no_qualifying_point_disables_acceptance(self):
        out = calibrate(np.array([[.99, .01]]), np.array([1]), np.array([[.99, .01]]))
        self.assertFalse(out['acceptanceEnabled'])
        self.assertFalse(out['screen_passed'])

    def test_coverage_is_distinct_from_precision(self):
        out = calibrate(np.array([[.999, .001], [.5, .5], [.5, .5]]), np.array([0, 0, 0]), np.array([[.5, .5]]))
        self.assertTrue(out['acceptanceEnabled'])
        self.assertFalse(out['screen_passed'])
        self.assertEqual(out['metrics']['known_accepted_precision'], 1.)
        self.assertEqual(out['metrics']['correct_known_coverage'], 1 / 3)

    def test_invalid_probabilities_and_targets_rejected(self):
        for scores in [np.array([[float('nan'), 0.]]), np.array([[.8, .8]])]:
            with self.assertRaises(ValueError):
                metrics(scores, np.array([0]), np.array([[.5, .5]]), .9, .1)
        with self.assertRaises(ValueError):
            metrics(np.array([[.5, .5]]), np.array([3]), np.array([[.5, .5]]), .9, .1)

    def test_small_count_uncertainty_visible(self):
        interval = wilson(1, 1)
        self.assertLess(interval[0], .3)
        self.assertAlmostEqual(interval[1], 1.)
        self.assertIsNone(wilson(0, 0))


if __name__ == '__main__':
    unittest.main()
