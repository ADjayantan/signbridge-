"""Artificial webcam fixtures verify importer contracts, not model accuracy."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from import_samples import combine_datasets, import_dataset, load_bounded_json, prepare_language, validate_dataset, validate_splits
from prepare_data import preprocess_pose
from train_model import validate_prepared


def frame(at_ms):
    points = [[.5, .5, 0] for _ in range(75)]
    points[11] = [.3, .5, 0]
    points[12] = [.7, .5, 0]
    return {"keypoints": points, "confidences": [1] * 75, "atMs": at_ms}


def sample(sample_id, signer="signer-a", label="WATER", language="isl", kind="known"):
    return {"id": sample_id, "createdAt": 1790899200000, "frameCount": 4,
            "durationMs": 375, "consent": True, "signLanguage": language,
            "kind": kind, "label": "__unknown__" if kind == "unknown" else label,
            "signerId": signer, "sessionId": "session-1",
            "frames": [frame(at) for at in (0, 125, 250, 375)]}


def fixture(languages=("isl",)):
    rows = []
    for language in languages:
        for signer in ("signer-a", "signer-b", "signer-c"):
            for label in ("WATER", "HELP"):
                rows.append(sample(f"{language}-{signer}-{label}", signer, label, language))
        for signer in ("signer-b", "signer-c"):
            rows.append(sample(f"{language}-{signer}-unknown", signer, language=language, kind="unknown"))
    dataset = {"format": "signbridge-pose-dataset-v1", "exportedAt": "2026-10-02T12:00:00.000Z", "samples": rows}
    splits = {"format": "signbridge-signer-splits-v1", "signers": {"signer-a": "train", "signer-b": "val", "signer-c": "test"}}
    return dataset, splits


class ImporterTests(unittest.TestCase):
    def test_outputs_trainer_compatible_arrays_with_existing_preprocessing(self):
        dataset, assignment = fixture()
        samples = validate_dataset(dataset)
        mapping = validate_splits(samples, assignment)
        arrays, metadata = prepare_language(samples, mapping, "isl")
        validate_prepared(arrays, metadata, "isl")
        self.assertEqual(arrays["labels"].tolist(), ["HELP", "WATER"])
        self.assertEqual(arrays["X_train"].shape, (2, 32, 81))
        row = samples[0]
        expected = preprocess_pose(np.asarray([f["keypoints"] for f in row["frames"]]), np.asarray([f["confidences"] for f in row["frames"]]))
        np.testing.assert_array_equal(arrays["X_train"][0], expected)
        self.assertEqual(arrays["y_unknown_validation"].tolist(), [-1])
        self.assertTrue(metadata["training_ready"])

    def test_signer_assignment_applies_across_sessions_and_languages(self):
        dataset, assignment = fixture(("isl", "asl"))
        row = sample("extra-session", "signer-a", "HELP")
        row["sessionId"] = "session-2"
        dataset["samples"].append(row)
        rows = validate_dataset(dataset)
        mapping = validate_splits(rows, assignment)
        for language in ("isl", "asl"):
            arrays, _ = prepare_language(rows, mapping, language)
            train = set(arrays["signer_ids_train"].tolist())
            val = set(arrays["signer_ids_val"].tolist()) | set(arrays["signer_ids_unknown_validation"].tolist())
            test = set(arrays["signer_ids_test"].tolist()) | set(arrays["signer_ids_unknown_test"].tolist())
            self.assertFalse(train & val or train & test or val & test)
            self.assertEqual(train, {"signer-a"})

    def test_missing_or_multi_split_assignments_fail_instead_of_random_split(self):
        dataset, assignment = fixture()
        rows = validate_dataset(dataset)
        del assignment["signers"]["signer-c"]
        with self.assertRaisesRegex(ValueError, "No explicit split"):
            validate_splits(rows, assignment)
        assignment["signers"]["signer-c"] = ["val", "test"]
        with self.assertRaisesRegex(ValueError, "exactly one"):
            validate_splits(rows, assignment)
        with self.assertRaises(ValueError):
            validate_splits(rows, {"signers": {}})

    def test_unknown_samples_cannot_enter_training(self):
        dataset, assignment = fixture()
        dataset["samples"].append(sample("unknown-in-train", kind="unknown"))
        with self.assertRaisesRegex(ValueError, "held out of training"):
            validate_splits(validate_dataset(dataset), assignment)

    def test_duplicate_ids_are_rejected_before_any_output(self):
        dataset, _ = fixture()
        duplicate = copy.deepcopy(dataset["samples"][0])
        duplicate["signerId"] = "signer-c"
        dataset["samples"].append(duplicate)
        with self.assertRaisesRegex(ValueError, "Duplicate sample IDs"):
            validate_dataset(dataset)

    def test_known_samples_cannot_hide_missing_shoulders_outside_sign_interval(self):
        dataset, _ = fixture()
        row = dataset["samples"][0]
        row["frames"] = [frame(i * 125) for i in range(8)]
        row["frameCount"], row["durationMs"] = 8, 875
        for pose in row["frames"][:4]:
            pose["confidences"][33] = pose["confidences"][54] = 0
        for pose in row["frames"][4:]:
            pose["confidences"][11] = pose["confidences"][12] = 0
        with self.assertRaisesRegex(ValueError, "signing interval"):
            validate_dataset(dataset)

    def test_known_samples_need_simultaneous_hand_and_both_shoulders(self):
        dataset, _ = fixture()
        row = dataset["samples"][0]
        row["frames"] = [frame(i * 125) for i in range(8)]
        row["frameCount"], row["durationMs"] = 8, 875
        for index, pose in enumerate(row["frames"]):
            pose["confidences"] = [0] * 75
            if index in (0, 2, 5, 7):
                pose["confidences"][33] = 1
            else:
                pose["confidences"][11] = pose["confidences"][12] = 1
        with self.assertRaisesRegex(ValueError, "Recapture.*together"):
            validate_dataset(dataset)
        row["kind"], row["label"] = "unknown", "__unknown__"
        self.assertEqual(validate_dataset(dataset)[0]["kind"], "unknown")
        row["kind"], row["label"] = "known", "WATER"
        row["frames"] = [frame(i * 125) for i in range(8)]
        for pose in row["frames"][4:]:
            pose["confidences"][12] = 0
        self.assertEqual(validate_dataset(dataset)[0]["kind"], "known")

    def test_negative_metadata_is_optional_and_never_inferred_from_a_prediction(self):
        dataset, _ = fixture()
        legacy = dataset["samples"][-1]
        legacy["prediction"] = {"status": "no_sign", "meaning": ""}
        for negative_type in ("nonsigning", "unsupported-sign", "unspecified"):
            row = sample(f"negative-{negative_type}", "signer-b", kind="unknown")
            row["negativeType"] = negative_type
            dataset["samples"].append(row)
        validated = validate_dataset(dataset)
        self.assertNotIn("negativeType", validated[-4])
        self.assertEqual([row["negativeType"] for row in validated[-3:]], ["nonsigning", "unsupported-sign", "unspecified"])
        self.assertNotIn("prediction", validated[-3])

    def test_negative_metadata_is_only_allowed_for_unknown_samples(self):
        for negative_type in ("nonsigning", "unsupported-sign", "unspecified", None, "idle", True, [], {}):
            for kind in ("known", "unknown"):
                if kind == "unknown" and isinstance(negative_type, str) and negative_type in ("nonsigning", "unsupported-sign", "unspecified"):
                    continue
                dataset, _ = fixture()
                row = sample("invalid-negative", "signer-b", kind=kind)
                row["negativeType"] = negative_type
                dataset["samples"].append(row)
                with self.subTest(kind=kind, negative_type=negative_type), self.assertRaisesRegex(ValueError, "Only unknown"):
                    validate_dataset(dataset)

    def test_capture_duration_is_optional_measured_window_with_inclusive_boundaries(self):
        dataset, _ = fixture()
        legacy = validate_dataset(dataset)
        self.assertTrue(all("captureDurationMs" not in row for row in legacy))
        row = dataset["samples"][0]
        row["frames"] = [frame(at) for at in (125, 250, 375, 500)]
        row["captureDurationMs"] = 900.5
        validated = validate_dataset(dataset)[0]
        self.assertEqual(validated["captureDurationMs"], 900.5)
        self.assertEqual(validated["durationMs"], 375)
        self.assertEqual(validated["frames"], row["frames"])
        for times, duration in (((0, 100, 200, 350), 350), ((11625, 11750, 11875, 12000), 12000)):
            row["frames"] = [frame(at) for at in times]
            row["durationMs"] = times[-1] - times[0]
            row["captureDurationMs"] = duration
            self.assertEqual(validate_dataset(dataset)[0]["captureDurationMs"], duration)

    def test_capture_duration_rejects_malicious_values_and_truncated_windows(self):
        for duration in (None, True, False, "900", [], {}, float("nan"), float("inf"), float("-inf"), -1, 349.99, 12000.01, 499.99):
            dataset, _ = fixture()
            row = dataset["samples"][0]
            row["frames"] = [frame(at) for at in (125, 250, 375, 500)]
            row["captureDurationMs"] = duration
            with self.subTest(duration=duration), self.assertRaisesRegex(ValueError, "Capture duration"):
                validate_dataset(dataset)
        dataset, _ = fixture()
        row = dataset["samples"][0]
        row["captureDurationMs"] = 1000
        row["negativeType"] = "nonsigning"
        with self.assertRaisesRegex(ValueError, "Only unknown"):
            validate_dataset(dataset)
        del row["negativeType"]
        for pose in row["frames"]:
            pose["confidences"] = [0] * 75
        with self.assertRaisesRegex(ValueError, "Recapture.*together"):
            validate_dataset(dataset)

    def test_capture_window_roundtrip_retains_manifest_metadata_without_changing_arrays(self):
        dataset, assignment = fixture()
        baseline, _ = prepare_language(validate_dataset(dataset), assignment["signers"], "isl")
        dataset["samples"][0]["captureDurationMs"] = 975.5
        dataset["samples"][-1]["captureDurationMs"] = 375
        nonsigning = sample("measured-idle", "signer-b", kind="unknown")
        nonsigning["captureDurationMs"], nonsigning["negativeType"] = 1100, "nonsigning"
        background = sample("measured-background", "signer-c", kind="unknown")
        background["captureDurationMs"] = 1200
        for pose in background["frames"]:
            pose["confidences"] = [0] * 75
        dataset["samples"].extend([nonsigning, background])
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "timed-inventory"
            manifest = import_dataset(json.loads(json.dumps(dataset)), assignment, output)
            raw = json.loads((output / "poses.json").read_text(encoding="utf-8"))
            saved_manifest = json.loads((output / "dataset-manifest.json").read_text(encoding="utf-8"))
            for rows in (raw["samples"], manifest["samples"], saved_manifest["samples"]):
                by_id = {row["id"]: row for row in rows}
                self.assertEqual(by_id[dataset["samples"][0]["id"]]["captureDurationMs"], 975.5)
                self.assertEqual(by_id[dataset["samples"][0]["id"]]["durationMs"], 375)
                self.assertNotIn("captureDurationMs", by_id[dataset["samples"][1]["id"]])
                self.assertEqual(by_id["measured-idle"]["captureDurationMs"], 1100)
                self.assertEqual(by_id["measured-background"]["captureDurationMs"], 1200)
            metadata = manifest["languages"]["isl"]
            self.assertEqual(metadata["nonsigning_samples"][0]["captureDurationMs"], 1100)
            self.assertEqual(metadata["background_samples"][0]["captureDurationMs"], 1200)
            with np.load(output / "isl.npz", allow_pickle=False) as prepared:
                self.assertEqual(set(prepared.files), set(baseline))
                for key in baseline:
                    np.testing.assert_array_equal(prepared[key], baseline[key])

    def test_nonfinite_boolean_out_of_bounds_and_duplicate_times_are_rejected(self):
        for field, value in (("atMs", -1), ("atMs", float("nan")), ("atMs", True), ("atMs", 12001)):
            dataset, _ = fixture()
            dataset["samples"][0]["frames"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_dataset(dataset)
        for value in (float("inf"), 10.001, "0.5", True):
            dataset, _ = fixture()
            dataset["samples"][0]["frames"][0]["keypoints"][0][0] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_dataset(dataset)
        dataset, _ = fixture()
        dataset["samples"][0]["frames"][1]["atMs"] = 0
        with self.assertRaisesRegex(ValueError, "Timestamps"):
            validate_dataset(dataset)

    def test_consent_counts_confidence_language_and_reserved_labels_are_validated(self):
        for field, value in (("consent", "true"), ("frameCount", 9), ("durationMs", 1), ("signLanguage", "both"),
                             ("createdAt", True), ("label", "__unknown__"), ("signerId", "Full Name")):
            dataset, _ = fixture()
            dataset["samples"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_dataset(dataset)
        dataset, _ = fixture()
        dataset["samples"][0]["frames"][0]["confidences"][0] = 1.01
        with self.assertRaises(ValueError):
            validate_dataset(dataset)

    def test_background_is_preserved_without_fabricated_calibration_features(self):
        dataset, assignment = fixture()
        background = sample("background", "signer-c", kind="unknown")
        for pose in background["frames"]:
            pose["confidences"] = [0] * 75
        dataset["samples"].append(background)
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "imported"
            manifest = import_dataset(dataset, assignment, output)
            self.assertEqual(manifest["sample_count"], 9)
            metadata = manifest["languages"]["isl"]
            self.assertEqual(metadata["background_samples"][0]["id"], "background")
            self.assertEqual(metadata["splits"]["unknown_test"]["clips"], 1)
            raw = json.loads((output / "poses.json").read_text(encoding="utf-8"))
            self.assertEqual(raw["samples"][-1]["frames"][0]["confidences"], [0] * 75)
            self.assertNotIn("negativeType", raw["samples"][-1])
            self.assertEqual(metadata["background_samples"][0]["negativeType"], "unspecified")

    def test_nonsigning_examples_remain_separate_even_with_model_eligible_visibility(self):
        dataset, assignment = fixture()
        baseline, _ = prepare_language(validate_dataset(dataset), assignment["signers"], "isl")
        for signer in ("signer-b", "signer-c"):
            for missing in (False, True):
                row = sample(f"nonsigning-{signer}-{missing}", signer, kind="unknown")
                row["negativeType"] = "nonsigning"
                if missing:
                    for pose in row["frames"]:
                        pose["confidences"] = [0] * 75
                dataset["samples"].append(row)
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "nonsigning-inventory"
            manifest = import_dataset(dataset, assignment, output)
            metadata = manifest["languages"]["isl"]
            self.assertEqual(manifest["negative_type_counts"], {"nonsigning": 4, "unsupported-sign": 0, "unspecified": 2})
            self.assertEqual(manifest["source_exports"][0]["negative_type_counts"], manifest["negative_type_counts"])
            self.assertEqual(metadata["negative_type_counts"], manifest["negative_type_counts"])
            self.assertEqual(len(metadata["nonsigning_samples"]), 4)
            self.assertEqual(metadata["background_samples"], [])
            self.assertEqual(metadata["splits"]["unknown_validation"]["clips"], 1)
            self.assertEqual(metadata["splits"]["unknown_test"]["clips"], 1)
            with np.load(output / "isl.npz", allow_pickle=False) as prepared:
                self.assertEqual(set(prepared.files), set(baseline))
                for key in baseline:
                    np.testing.assert_array_equal(prepared[key], baseline[key])
            raw = json.loads((output / "poses.json").read_text(encoding="utf-8"))
            self.assertTrue(all(row["negativeType"] == "nonsigning" and "prediction" not in row for row in raw["samples"][-4:]))
            self.assertTrue(all(row["negativeType"] == "nonsigning" for row in manifest["samples"][-4:]))

    def test_nonsigning_inventory_cannot_replace_required_unknown_holdouts(self):
        dataset, assignment = fixture()
        for row in dataset["samples"]:
            if row["kind"] == "unknown":
                row["negativeType"] = "nonsigning"
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "inventory-only"
            manifest = import_dataset(dataset, assignment, output)
            metadata = manifest["languages"]["isl"]
            self.assertFalse(metadata["training_ready"])
            self.assertEqual(len(metadata["nonsigning_samples"]), 2)
            self.assertIn("No inference-eligible unknown samples in unknown_validation", metadata["blocking_reasons"])
            self.assertIn("No inference-eligible unknown samples in unknown_test", metadata["blocking_reasons"])
            self.assertFalse((output / "isl.npz").exists())
        dataset["samples"].append({**sample("nonsigning-training-signer", kind="unknown"), "negativeType": "nonsigning"})
        with self.assertRaisesRegex(ValueError, "held out of training"):
            validate_splits(validate_dataset(dataset), assignment)

    def test_nonsigning_only_collection_needs_no_known_label_or_model_prediction(self):
        row = sample("idle-only", "recorder-a", kind="unknown")
        row["negativeType"] = "nonsigning"
        for pose in row["frames"]:
            pose["confidences"] = [0] * 75
        dataset = {"format": "signbridge-pose-dataset-v1", "exportedAt": "2026-10-02T12:00:00.000Z", "samples": [row]}
        assignment = {"format": "signbridge-signer-splits-v1", "signers": {"recorder-a": "val"}}
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "only-idle"
            manifest = import_dataset(dataset, assignment, output)
            metadata = manifest["languages"]["isl"]
            self.assertEqual(manifest["known_count"], 0)
            self.assertEqual(manifest["negative_type_counts"]["nonsigning"], 1)
            self.assertFalse(metadata["training_ready"])
            self.assertIn("At least two known labels are required", metadata["blocking_reasons"])
            self.assertEqual(metadata["nonsigning_samples"][0]["split"], "unknown_validation")
            self.assertFalse((output / "isl.npz").exists())
            self.assertTrue((output / "poses.json").exists())
            self.assertNotIn("prediction", json.loads((output / "poses.json").read_text(encoding="utf-8"))["samples"][0])

    def test_explicit_unsupported_sign_keeps_existing_unknown_holdout_behavior(self):
        dataset, assignment = fixture()
        baseline, _ = prepare_language(validate_dataset(dataset), assignment["signers"], "isl")
        for row in dataset["samples"]:
            if row["kind"] == "unknown":
                row["negativeType"] = "unsupported-sign"
        prepared, metadata = prepare_language(validate_dataset(dataset), assignment["signers"], "isl")
        self.assertTrue(metadata["training_ready"])
        self.assertEqual(metadata["negative_type_counts"], {"nonsigning": 0, "unsupported-sign": 2, "unspecified": 0})
        self.assertEqual(metadata["nonsigning_samples"], [])
        for key in baseline:
            np.testing.assert_array_equal(prepared[key], baseline[key])

    def test_incomplete_collection_emits_inventory_and_explicit_blocking_reasons(self):
        dataset, assignment = fixture()
        dataset["samples"] = [row for row in dataset["samples"] if row["signerId"] != "signer-c"]
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "imported"
            manifest = import_dataset(dataset, assignment, output)
            self.assertFalse(manifest["languages"]["isl"]["training_ready"])
            self.assertTrue(any("Missing known labels in test" in reason for reason in manifest["languages"]["isl"]["blocking_reasons"]))
            self.assertFalse((output / "isl.npz").exists())
            self.assertTrue((output / "dataset-manifest.json").exists())

    def test_never_overwrites_an_existing_output_directory(self):
        dataset, assignment = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            marker = output / "original.txt"
            marker.write_text("preserve", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not be overwritten"):
                import_dataset(dataset, assignment, output)
            self.assertEqual(marker.read_text(encoding="utf-8"), "preserve")
            self.assertEqual(sorted(path.name for path in output.iterdir()), ["original.txt"])

    def test_json_reader_rejects_duplicate_keys_nonfinite_and_oversized_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "data.json"
            for text in ('{"signers":{"same":"train","same":"test"}}', '{"x":NaN}', '{"x":Infinity}'):
                path.write_text(text, encoding="utf-8")
                with self.subTest(text=text), self.assertRaises(ValueError):
                    load_bounded_json(path)
            path.write_text('"too long"', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "at most"):
                load_bounded_json(path, 3)

    def test_disjoint_exports_form_complete_signer_separated_training_splits(self):
        dataset, assignment = fixture(("isl", "asl"))
        batches = [{**dataset, "samples": [row for row in dataset["samples"] if row["signerId"] == signer]}
                   for signer in ("signer-a", "signer-b", "signer-c")]
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "multiple-batches"
            manifest = import_dataset(batches, assignment, output, ["a" * 64, "b" * 64, "c" * 64])
            self.assertEqual(manifest["sample_count"], 16)
            self.assertEqual(manifest["known_count"], 12)
            self.assertEqual(manifest["unknown_count"], 4)
            self.assertEqual(len(manifest["source_exports"]), 3)
            self.assertIsNone(manifest["source_sha256"])
            for language in ("isl", "asl"):
                self.assertTrue(manifest["languages"][language]["training_ready"])
                with np.load(output / f"{language}.npz", allow_pickle=False) as prepared:
                    validate_prepared(prepared, manifest["languages"][language], language)
                    self.assertEqual(prepared["signer_ids_train"].tolist(), ["signer-a", "signer-a"])
                    self.assertEqual(prepared["y_unknown_test"].tolist(), [-1])
            raw = json.loads((output / "poses.json").read_text(encoding="utf-8"))
            self.assertEqual(raw["format"], "signbridge-pose-collection-v1")
            self.assertEqual(len(raw["samples"]), 16)
            self.assertEqual(raw["samples"][0]["frames"][1]["atMs"], 125)

    def test_duplicate_ids_across_exports_are_rejected_without_partial_outputs(self):
        dataset, assignment = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "must-not-exist"
            with self.assertRaisesRegex(ValueError, "Duplicate sample ID across exports"):
                import_dataset([dataset, copy.deepcopy(dataset)], assignment, output)
            self.assertFalse(output.exists())

    def test_combined_collection_limits_fail_explicitly(self):
        dataset, _ = fixture()
        other = copy.deepcopy(dataset)
        for row in other["samples"]:
            row["id"] = f"second-{row['id']}"
        with patch("import_samples.MAX_COLLECTION_SAMPLES", 15):
            with self.assertRaisesRegex(ValueError, "10000 sample collection limit"):
                combine_datasets([dataset, other])
        source_size = len(json.dumps(dataset).encode("utf-8"))
        with patch("import_samples.MAX_COLLECTION_BYTES", source_size):
            with self.assertRaisesRegex(ValueError, "256 MB collection limit"):
                combine_datasets([dataset, other], source_bytes=[source_size, source_size])

    def test_each_source_export_remains_bounded_even_when_collection_is_larger(self):
        dataset, _ = fixture()
        oversized = {**dataset, "samples": [sample(f"clip-{i}") for i in range(251)]}
        with self.assertRaisesRegex(ValueError, "at most 250"):
            combine_datasets([oversized])
        with self.assertRaisesRegex(ValueError, "at most 32 MB"):
            combine_datasets([dataset], source_bytes=[32 * 1024 * 1024 + 1])

    def test_cli_accepts_repeated_dataset_arguments(self):
        dataset, assignment = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            paths = [directory / "batch-one.json", directory / "batch-two.json"]
            for path, rows in zip(paths, (dataset["samples"][:4], dataset["samples"][4:])):
                path.write_text(json.dumps({**dataset, "samples": rows}), encoding="utf-8")
            splits = directory / "splits.json"
            splits.write_text(json.dumps(assignment), encoding="utf-8")
            output = directory / "collection"
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("import_samples.py")),
                                     "--dataset", str(paths[0]), "--dataset", str(paths[1]),
                                     "--splits", str(splits), "--output-dir", str(output)],
                                    capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report["samples"], 8)
            self.assertTrue(report["languages"]["isl"]["training_ready"])
            self.assertTrue((output / "isl.npz").exists())


if __name__ == "__main__":
    unittest.main()
