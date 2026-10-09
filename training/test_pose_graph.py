"""Full-joint feature, missingness, normalization and synthetic parity evidence."""
import json
from pathlib import Path
import unittest

import numpy as np

from pose_graph import (CONTRACT, CONTRACT_ID, EDGES, adjacency_hash, adjacency_matrix,
                        contract_hash, fit_normalization, normalize_features, preprocess_pose_graph)


def synthetic_pose(kind="regular"):
    keypoints = np.zeros((9, 75, 3), dtype=np.float32)
    confidence = np.zeros((9, 75), dtype=np.float32)
    keypoints[:, 11] = [.3, .5, 0]
    keypoints[:, 12] = [.7, .5, 0]
    confidence[:, [11, 12]] = 1
    for step in range(1, 8):
        keypoints[step, 33] = [.3 + step * .04, .6, 0]
        keypoints[step, 36] = [.32 + step * .035, .67, .1]
        keypoints[step, 54] = [.65 - step * .03, .55, 0]
        confidence[step, [33, 36, 54]] = [1, .8, 1]
    confidence[4, 36] = .49
    if kind == "shoulder-gap":
        confidence[4, [11, 12]] = .1
    elif kind == "clipped":
        keypoints[2, 36] = [100, -100, 0]
        keypoints[:, 12] = [.31, .5, 0]
    elif kind == "no-hands":
        confidence[:, [33, 54]] = 0
    return {"keypoints": keypoints, "confidences": confidence}


def write_parity_fixtures(path):
    """Deliberately synthetic: never writes a source clip or participant pose."""
    cases = []
    for kind in ("regular", "shoulder-gap", "clipped", "no-hands"):
        pose = synthetic_pose(kind)
        item = {"name": kind, "frames": [{"keypoints": points.tolist(), "confidences": scores.tolist()}
                                          for points, scores in zip(pose["keypoints"], pose["confidences"])]}
        try:
            features, mask = preprocess_pose_graph(**pose)
            normalization = fit_normalization(features[None], mask[None])
            item.update({"features": features.tolist(), "mask": mask.tolist(), "normalization": normalization,
                         "normalized": normalize_features(features, mask, normalization).tolist()})
        except ValueError as error:
            item["error"] = str(error)
        cases.append(item)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"format": "signbridge-graph-feature-fixtures-v1", "synthetic": True,
        "featureContract": CONTRACT_ID, "contractHash": contract_hash(), "adjacencyHash": adjacency_hash(), "cases": cases},
        separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")


class PoseGraphTests(unittest.TestCase):
    def test_all_hand_joints_are_retained_and_missing_confidence_never_blended(self):
        features, mask = preprocess_pose_graph(**synthetic_pose())
        self.assertEqual(features.shape, (32, 75, 3))
        self.assertEqual(mask.dtype, np.bool_)
        self.assertTrue(mask[:, 36].any())  # Finger joint omitted by GRU27.
        self.assertTrue((~mask[:, 36]).any())
        self.assertEqual(set(np.round(features[:, 36, 2], 5)), {0, np.float32(.8)})
        np.testing.assert_array_equal(mask, features[..., 2] >= .5)
        self.assertTrue(np.all(features[~mask] == 0))

    def test_shoulder_dropout_masks_the_entire_measured_frame(self):
        features, mask = preprocess_pose_graph(**synthetic_pose("shoulder-gap"))
        self.assertTrue((~mask.any(axis=1)).any())
        self.assertTrue(np.all(features[~mask.any(axis=1)] == 0))

    def test_body_frame_gate_and_node_gate_are_distinct(self):
        pose = synthetic_pose()
        pose["confidences"][:, [11, 12]] = .3
        features, mask = preprocess_pose_graph(**pose)
        self.assertFalse(mask[:, 11].any())
        self.assertTrue(mask[:, 33].all())
        self.assertTrue(np.all(features[:, 11] == 0))

    def test_translation_and_scale_do_not_change_features(self):
        pose = synthetic_pose()
        original, mask = preprocess_pose_graph(**pose)
        changed = {"keypoints": pose["keypoints"].copy(), "confidences": pose["confidences"].copy()}
        changed["keypoints"][..., :2] = changed["keypoints"][..., :2] * 2 + [3, -2]
        actual, actual_mask = preprocess_pose_graph(**changed)
        np.testing.assert_array_equal(mask, actual_mask)
        np.testing.assert_allclose(original, actual, atol=2e-6, rtol=0)

    def test_coordinate_clip_and_shoulder_width_floor_are_bounded(self):
        features, _ = preprocess_pose_graph(**synthetic_pose("clipped"))
        self.assertEqual(float(features[..., 0].max()), 5)
        self.assertEqual(float(features[..., 1].min()), -5)
        self.assertTrue(np.isfinite(features).all())

    def test_quality_and_malformed_arrays_fail_without_fabricating_features(self):
        with self.assertRaisesRegex(ValueError, "hand-visible"):
            preprocess_pose_graph(**synthetic_pose("no-hands"))
        pose = synthetic_pose()
        pose["confidences"][:, [11, 12]] = 0
        with self.assertRaisesRegex(ValueError, "valid-shoulder"):
            preprocess_pose_graph(**pose)
        for invalid in (np.nan, 1e7):
            pose = synthetic_pose()
            pose["keypoints"][0, 0, 0] = invalid
            with self.assertRaises(ValueError):
                preprocess_pose_graph(**pose)
        with self.assertRaises(ValueError):
            preprocess_pose_graph(np.zeros((4, 74, 3)), np.ones((4, 74)))

    def test_nonoverlapping_hand_and_shoulder_observations_cannot_become_zero_valid_input(self):
        points = np.zeros((100, 75, 3), dtype=np.float32)
        confidence = np.zeros((100, 75), dtype=np.float32)
        points[:, 11] = [.3, .5, 0]
        points[:, 12] = [.7, .5, 0]
        confidence[[0, 1, 98, 99], 33] = 1
        confidence[20:24, [11, 12]] = .3
        with self.assertRaisesRegex(ValueError, "No valid graph joints"):
            preprocess_pose_graph(points, confidence)

    def test_valid_training_statistics_exclude_missing_zero_observations(self):
        values = np.zeros((1, 32, 75, 3), dtype=np.float32)
        mask = np.zeros((1, 32, 75), dtype=bool)
        values[0, :2, 33] = [[1, 2, 1], [3, 4, 1]]
        mask[0, :2, 33] = True
        normalization = fit_normalization(values, mask)
        self.assertEqual(normalization["mean"][33], [2, 3])
        self.assertEqual(normalization["std"][33], [1, 1])
        self.assertEqual(normalization["validCounts"][33], 2)
        self.assertEqual(normalization["mean"][74], [0, 0])
        self.assertEqual(normalization["std"][74], [1, 1])
        normalized = normalize_features(values, mask, normalization)
        self.assertTrue(np.all(normalized[~mask] == 0))
        np.testing.assert_array_equal(normalized[..., 2], values[..., 2])
        np.testing.assert_array_equal(normalized[0, :2, 33, :2], [[-1, -1], [1, 1]])

    def test_normalization_rejects_forged_masks_or_incompatible_statistics(self):
        values, mask = preprocess_pose_graph(**synthetic_pose())
        bad = mask.copy()
        bad[0, 36] = not bad[0, 36]
        with self.assertRaisesRegex(ValueError, "mask differs"):
            fit_normalization(values[None], bad[None])
        normalization = fit_normalization(values[None], mask[None])
        normalization["std"][36][0] = 0
        with self.assertRaisesRegex(ValueError, "statistics"):
            normalize_features(values, mask, normalization)

    def test_anatomical_graph_has_full_hands_wrist_bridges_and_self_loops(self):
        self.assertEqual(len(EDGES), 79)
        self.assertEqual(len(set(EDGES)), 79)
        adjacency = adjacency_matrix()
        np.testing.assert_array_equal(adjacency, adjacency.T)
        self.assertTrue(np.all(np.diag(adjacency) == 1))
        self.assertEqual(int(adjacency.sum()), 233)
        for edge in ((15, 33), (16, 54), (36, 37), (73, 74)):
            self.assertEqual(adjacency[edge], 1)
        self.assertEqual(len(contract_hash()), 64)
        self.assertEqual(len(adjacency_hash()), 64)

    def test_committed_fixtures_are_synthetic_and_reproduce_expected_features(self):
        path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "graph-features.json"
        fixtures = json.loads(path.read_text())
        self.assertIs(fixtures["synthetic"], True)
        self.assertEqual(fixtures["contractHash"], contract_hash())
        for item in fixtures["cases"]:
            keypoints = np.asarray([frame["keypoints"] for frame in item["frames"]], dtype=np.float32)
            confidence = np.asarray([frame["confidences"] for frame in item["frames"]], dtype=np.float32)
            if "error" in item:
                with self.assertRaises(ValueError):
                    preprocess_pose_graph(keypoints, confidence)
            else:
                features, mask = preprocess_pose_graph(keypoints, confidence)
                np.testing.assert_array_equal(features, np.asarray(item["features"], dtype=np.float32))
                np.testing.assert_array_equal(mask, item["mask"])
                np.testing.assert_allclose(normalize_features(features, mask, item["normalization"]), item["normalized"], atol=1e-6)


if __name__ == "__main__":
    unittest.main()
