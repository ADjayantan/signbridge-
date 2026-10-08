"""Architecture/masking/export checks. Synthetic fixtures are not accuracy data."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

from export_graph_model import export_and_check
from graph_models import MaskedGraphBlock, SignGraphModel, load_checkpoint, make_adjacency
from train_graph_models import check_features, validation_score
from pose_graph import fit_normalization, normalize_features


class GraphModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def model(self, architecture="stgcn", mean=None, std=None):
        return SignGraphModel(4, architecture, np.full((75, 2), 2) if mean is None else mean,
            np.full((75, 2), .5) if std is None else std)

    def test_adjacency_is_undirected_self_connected_and_has_bridges(self):
        adjacency = make_adjacency()
        np.testing.assert_array_equal(adjacency, adjacency.T)
        np.testing.assert_array_equal(adjacency.diagonal(), np.ones(75))
        self.assertEqual(adjacency[15, 33], 1)
        self.assertEqual(adjacency[16, 54], 1)
        self.assertEqual(int((adjacency.sum() - 75) / 2), 79)

    def test_normalization_remasks_absent_nodes_and_preserves_confidence(self):
        pose = torch.zeros(2, 32, 75, 3)
        pose[:, :, 0] = torch.tensor([3., 1., .8])
        normalized, mask = self.model().preprocess(pose)
        torch.testing.assert_close(normalized[:, :, 0, 0], torch.full((2, 32), 2.))
        torch.testing.assert_close(normalized[:, :, 0, 1], torch.full((2, 32), -2.))
        torch.testing.assert_close(normalized[:, :, 0, 2], torch.full((2, 32), .8))
        self.assertEqual(int(torch.count_nonzero(normalized[:, :, 1:])), 0)
        self.assertEqual(int(mask.sum()), 64)

    def test_embedded_normalization_matches_reference_preprocessing(self):
        rng = np.random.default_rng(42)
        pose = rng.uniform(-3, 3, (3, 32, 75, 3)).astype(np.float32)
        pose[..., 2] = rng.uniform(.5, 1, pose.shape[:-1])
        pose[:, :, ::4] = 0
        mask = pose[..., 2] >= .5
        normalization = fit_normalization(pose, mask)
        reference = normalize_features(pose, mask, normalization)
        model = self.model(mean=normalization["mean"], std=normalization["std"])
        actual, _ = model.preprocess(torch.from_numpy(pose))
        np.testing.assert_allclose(actual.numpy(), reference, atol=1e-5, rtol=0)

    def test_invalid_confidence_does_not_become_a_feature(self):
        pose = torch.full((1, 32, 75, 3), 4.)
        pose[..., 2] = .49
        normalized, mask = self.model().preprocess(pose)
        self.assertEqual(int(torch.count_nonzero(normalized)), 0)
        self.assertEqual(int(torch.count_nonzero(mask)), 0)

    def test_neighbor_normalization_uses_only_available_neighbors(self):
        adjacency = np.ones((3, 3), dtype=np.float32)
        block = MaskedGraphBlock(1, 1, adjacency)
        x = torch.tensor([[[[2.], [100.], [4.]]]])
        mask = torch.tensor([[[1., 0., 1.]]])
        actual = block.aggregate(x, mask)
        torch.testing.assert_close(actual, torch.tensor([[[[3.], [0.], [3.]]]]))

    def test_zero_neighbors_are_finite_and_zero(self):
        block = MaskedGraphBlock(1, 2, np.ones((3, 3), dtype=np.float32))
        actual = block.aggregate(torch.randn(1, 2, 3, 1), torch.zeros(1, 2, 3))
        self.assertTrue(bool(torch.isfinite(actual).all()))
        self.assertEqual(int(torch.count_nonzero(actual)), 0)

    def test_every_graph_block_keeps_absent_destinations_zero(self):
        block = MaskedGraphBlock(3, 4, np.eye(75, dtype=np.float32)).eval()
        pose = torch.randn(2, 32, 75, 3)
        mask = torch.zeros(2, 32, 75); mask[:, :, :10] = 1
        actual = block(pose, mask)
        self.assertEqual(int(torch.count_nonzero(actual[:, :, 10:])), 0)

    def test_temporal_stride_keeps_output_mask_aligned_to_measured_centers(self):
        block = MaskedGraphBlock(3, 4, np.eye(75, dtype=np.float32), stride=2, depthwise=True).eval()
        pose = torch.randn(1, 6, 75, 3)
        mask = torch.zeros(1, 6, 75); mask[:, 2, :10] = 1
        actual = block(pose, mask)
        self.assertEqual(tuple(actual.shape), (1, 3, 75, 4))
        self.assertEqual(int(torch.count_nonzero(actual[mask[:, ::2] == 0])), 0)

    def test_compact_graph_has_frozen_widths_strides_and_depthwise_temporal(self):
        model = self.model()
        self.assertEqual([block.stride for block in model.blocks], [1, 2, 2])
        self.assertEqual([block.temporal.out_channels for block in model.blocks], [32, 64, 64])
        self.assertTrue(all(block.temporal.groups == block.temporal.out_channels for block in model.blocks))

    def test_full_joint_candidates_are_under_budget_and_batched(self):
        for architecture in ("gru75", "stgcn"):
            model = self.model(architecture).eval()
            pose = torch.zeros(2, 32, 75, 3); pose[..., 2] = .8
            self.assertEqual(tuple(model(pose).shape), (2, 4))
            self.assertLess(sum(p.numel() for p in model.parameters()), 500000)

    def test_all_invalid_graph_forward_stays_finite(self):
        logits = self.model().eval()(torch.zeros(1, 32, 75, 3))
        self.assertTrue(bool(torch.isfinite(logits).all()))

    def test_legacy_control_normalizes_81_dimensions(self):
        model = SignGraphModel(4, "gru27", np.ones(81), np.full(81, 2))
        actual, mask = model.preprocess(torch.full((2, 32, 81), 3.))
        torch.testing.assert_close(actual, torch.ones(2, 32, 81))
        self.assertIsNone(mask)
        self.assertEqual(tuple(model(torch.ones(2, 32, 81)).shape), (2, 4))

    def test_corrupt_normalization_is_rejected_before_inference(self):
        for mean, std in ((np.zeros((75, 3)), np.ones((75, 2))),
                          (np.zeros((75, 2)), np.zeros((75, 2))),
                          (np.full((75, 2), np.nan), np.ones((75, 2)))):
            with self.assertRaisesRegex(ValueError, "normalization"):
                self.model(mean=mean, std=std)

    def test_feature_validation_rejects_false_masks_and_nonzero_missing(self):
        raw = np.zeros((2, 32, 75, 3), dtype=np.float32)
        raw[:, :, 0, 2] = .8
        mask = raw[..., 2] >= .5
        check_features(raw, mask)
        with self.assertRaisesRegex(ValueError, "confidence mask"):
            check_features(raw, np.ones_like(mask))
        raw[:, :, 1, 0] = 1
        with self.assertRaisesRegex(ValueError, "Missing observations"):
            check_features(raw, mask)

    def test_macro_recall_does_not_weight_common_classes_more(self):
        scores = np.array([[.9, .1], [.9, .1], [.9, .1], [.9, .1]])
        recall, loss = validation_score(scores, np.array([0, 0, 0, 1]), 2)
        self.assertEqual(recall, .5)
        self.assertGreater(loss, 0)

    def test_checkpoint_uses_tensor_only_load_and_verifies_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.pt"
            model = self.model("gru75")
            torch.save(model.state_dict(), path)
            run = {"architecture": "gru75", "labels": ["A", "B", "C", "D"],
                "normalization": {"mean": model.mean.tolist(), "std": model.std.tolist()},
                "weightsSha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            path.with_name("run.json").write_text(json.dumps(run), encoding="utf-8")
            actual, metadata = load_checkpoint(path)
            self.assertEqual(actual.architecture, "gru75")
            self.assertEqual(metadata["labels"], run["labels"])
            path.write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                load_checkpoint(path)

    def test_graph_native_onnx_probability_parity(self):
        pose = np.zeros((2, 32, 75, 3), dtype=np.float32)
        pose[0, :, :20, 2] = .8
        for architecture in ("gru75", "stgcn"):
            with self.subTest(architecture=architecture), tempfile.TemporaryDirectory() as directory:
                report, _ = export_and_check(self.model(architecture).eval(), pose, Path(directory) / "model.onnx")
                self.assertLessEqual(report["maxProbabilityError"], 1e-4)
                self.assertTrue(report["top1Matches"])
                self.assertEqual(report["fixtures"], 2)


if __name__ == "__main__":
    unittest.main()
