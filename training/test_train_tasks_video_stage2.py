"""Declared stage-two weighting/objective invariants; no recognition claim."""
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

from camera_aligned_study import export_candidate, sha256
from test_camera_aligned_study import GuardedInventory, inventory_fixture, pose
from test_train_tasks_video_study import prepared_fixture
import train_tasks_video_stage2 as study


class TasksStageTwoTests(unittest.TestCase):
    def test_first_trial_runner_and_candidate_remain_exact_frozen_bytes(self):
        root = Path(__file__).resolve().parents[1]
        directory = root/"training/artifacts/tasks-video-isl-2026-10-13"
        if not directory.is_dir(): self.skipTest("Local ignored first-trial artifact unavailable")
        frozen = json.loads((directory/"frozen-candidate.json").read_text())
        self.assertEqual(sha256(root/"training/train_tasks_video_study.py"), frozen["sourceHashes"]["tasksRunner"])
        self.assertEqual(sha256(directory/"candidate.json"), frozen["candidateSha256"])
        self.assertNotEqual(Path(study.__file__).name, "train_tasks_video_study.py")

    def test_fixed_development_constants_retain_known_outputs_and_acceptance_policy(self):
        self.assertEqual((study.TASKS_WEIGHT, study.TASKS_UNKNOWN_WEIGHT), (16,4))
        self.assertEqual((study.OE_WEIGHT, study.LEARNING_RATE), (.25,.0005))
        self.assertEqual((study.THRESHOLD, study.MARGIN), (.95,.30))
        self.assertEqual(study.INITIAL_SHA256, "a77f33b3f0d2ca7570b041e4cf93fa1ee3374efc6e974cb975ae80f587041004")

    def test_training_weights_real_tasks_rows_and_counts_distinct_sources_separately(self):
        _, _, _, tasks = prepared_fixture()
        original = {"train": [{"clipId": "old/train.MOV", "target": 0}], "val": object(), "test": object()}
        raw = pose(); raw["keypoints"][:, :, 0] *= 1080; raw["keypoints"][:, :, 1] *= 1920
        outliers = [{"clipId": f"fresh/negative-{i}.MOV", "sourceLabel": "UNKNOWN"} for i in range(2)]
        with patch.object(study, "read_original_pose", return_value=raw) as reader:
            arrays, report = study.arrays_for_fit(original, object(), outliers, tasks)
        self.assertEqual([call.args[1] for call in reader.call_args_list], ["old/train.MOV", "fresh/negative-0.MOV", "fresh/negative-1.MOV"])
        self.assertEqual(len(arrays["X"]), 17); self.assertEqual(len(arrays["unknown"]), 6)
        self.assertEqual(report["tasksKnownClips"], 1); self.assertEqual(report["tasksRowWeight"], 16)
        self.assertEqual(report["tasksUnknownClips"], 1); self.assertEqual(report["tasksUnknownRowWeight"], 4)
        self.assertEqual(report["distinctKnownTrainingClips"], 2)
        self.assertEqual(report["distinctNegativeTrainingClips"], 3)
        self.assertEqual(report["archiveNegativeTrainingClips"], 2)
        np.testing.assert_array_equal(arrays["unknown"][0], arrays["unknown"][3])
        self.assertNotIn("cameraFrames", report["taskOutcomes"][0])

    def test_report_accepted_macro_wrong_rate_and_unknown_rate_use_all_source_counts(self):
        labels, _, _, tasks = prepared_fixture()
        known = tasks[1]
        second = {**known, "clipId": "second-word0"}
        third = {**known, "clipId": "word1", "label": labels[1], "target": 1}
        failed = {**third, "clipId": "failed-word1", "status": "error", "qualityCode": "extraction-error", "features": None}
        unknown = tasks[-1]
        failed_unknown = {**unknown, "clipId": "failed-unknown", "status": "error", "qualityCode": "extraction-error", "features": None}
        scores = np.zeros((3,49)); scores[0,0],scores[0,1]=.98,.02; scores[1,1],scores[1,0]=.97,.03; scores[2,1],scores[2,0]=.94,.06
        oov = np.zeros((1,49)); oov[0,0],oov[0,1]=.97,.03
        with patch.object(study,"artifact_scores",side_effect=[scores,oov]):
            result = study.task_report({"labels": labels}, [known,second,third,failed,unknown,failed_unknown], "val", "unknown_val")
        self.assertEqual(result["knownSourceClips"], 4); self.assertEqual(result["unknownSourceClips"], 2)
        self.assertEqual(result["macroRecallAllSource"], .5)
        self.assertEqual(result["macroAcceptedCorrectRecallAllSource"], .25)
        self.assertEqual(result["accepted_incorrect"], 1)
        self.assertEqual(result["unknownFalseAcceptRateAllSource"], .5)
        self.assertEqual(study.checkpoint_objective(result), -.5)

    def test_checkpoint_does_not_reward_correct_but_entirely_rejected_top1_guesses(self):
        rejected = {"macroRecallAllSource": 1., "macroAcceptedCorrectRecallAllSource": 0., "accepted_incorrect": 0,
                    "knownSourceClips": 6, "unknownFalseAcceptRateAllSource": 0.}
        accepted = {**rejected, "macroRecallAllSource": .75, "macroAcceptedCorrectRecallAllSource": .75}
        self.assertEqual(study.checkpoint_objective(rejected), 0.)
        self.assertGreater(study.checkpoint_objective(accepted), study.checkpoint_objective(rejected))

    def test_oe_loss_stays_exact_quarter_uniform_target_cross_entropy(self):
        import torch
        known = torch.tensor([[2., -1., .5]], requires_grad=True)
        unknown = torch.tensor([[3., .2, -2.], [.1, .3, .5]], requires_grad=True)
        targets = torch.tensor([0])
        expected = torch.nn.functional.cross_entropy(known, targets) - .25*unknown.log_softmax(-1).mean()
        torch.testing.assert_close(study.training_loss(known, targets, unknown), expected)
        expected.backward()
        torch.testing.assert_close(unknown.grad, .25*(unknown.detach().softmax(-1)-1/3)/2)

    def test_learning_inventory_still_excludes_final_targets_and_features(self):
        data, metadata = inventory_fixture()
        labels, inventory = study.learning_inventory(GuardedInventory(data), metadata, [])
        self.assertEqual(len(labels),49); self.assertNotIn("test",inventory)
        self.assertNotIn("unknown_test",inventory)

    def test_bounded_toy_fit_reports_both_macros_without_changing_normalization(self):
        import torch
        from train_model import SignGRU
        labels, _, _, tasks = prepared_fixture(); torch.manual_seed(42)
        initial = export_candidate(SignGRU(49), labels, np.zeros(81), np.ones(81))
        arrays = {"X": np.stack([tasks[0]["features"]]), "y": np.asarray([0],dtype=np.int64), "unknown": np.stack([tasks[2]["features"]])}
        candidate, report = study.fit(SimpleNamespace(seed=42,threads=1,epochs=1,max_seconds=.001), initial, arrays, tasks)
        self.assertEqual(report["epochs"],1); self.assertEqual(report["stopReason"],"wall-clock-budget")
        self.assertIn("macroAcceptedCorrectRecallAllSource",report["history"][0]); self.assertIn("macroRecallAllSource",report["history"][0])
        self.assertEqual(candidate["labels"],labels); self.assertEqual(candidate["mean"],initial["mean"])
        self.assertEqual(candidate["std"],initial["std"]); self.assertEqual(candidate["threshold"],.95); self.assertEqual(candidate["margin"],.3)
        self.assertFalse(candidate["research"]["promoted"])


if __name__ == "__main__": unittest.main()
