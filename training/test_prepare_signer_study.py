"""Paired feature/control IDs, disjoint known signers and honest unknown overlap."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from pose_graph import CONTRACT_ID, SPLITS, adjacency_hash, contract_hash, fit_normalization
from prepare_data import JOINTS
from prepare_graph_data import sha256_file
from prepare_signer_study import assign_signers, assign_strict_negatives, prepare_study, record_strict_protocol
from train_graph_models import load_data


def sources(root, missing_signer=False, sparse_class=False, strict_pool=False):
    graph, legacy = {"labels": np.asarray(["HELLO", "THANKS"]), "raw_labels": np.asarray(["hello", "thanks"])}, {"labels": np.asarray(["HELLO", "THANKS"]), "raw_labels": np.asarray(["hello", "thanks"])}
    for split in SPLITS:
        if split in ("train", "val", "test"):
            identities = {"train": range(6), "val": range(6, 8), "test": range(8, 10)}[split]
            rows = [(signer, target, f"known-{signer}-{target}") for signer in identities for target in range(2)
                    if not sparse_class or target == 0 or signer in (0, 6, 9)]
        else:
            if strict_pool:
                pool = [(signer, -1, f"strict-{signer}-{clip}") for signer in range(13) for clip in range(10)]
                pool.extend([(-1, -1, "missing-negative-0"), (-1, -1, "missing-negative-1")])
                rows = pool[0::2] if split == "unknown_validation" else pool[1::2]
            else:
                rows = [(0, -1, f"{split}-0"), (7, -1, f"{split}-1")]
        features = np.zeros((len(rows), 32, 75, 3), dtype=np.float32)
        features[..., 2] = 1
        old = np.zeros((len(rows), 32, 81), dtype=np.float32)
        for index, (signer, target, _) in enumerate(rows):
            features[index, ..., :2] = signer * .05 + max(target, 0) * .1
            old[index] = signer * .07 + max(target, 0) * .05
        graph[f"X_{split}"] = features
        graph[f"mask_{split}"] = np.ones(features.shape[:-1], dtype=bool)
        legacy[f"X_{split}"] = old
        for collection in (graph, legacy):
            collection[f"y_{split}"] = np.asarray([target for _, target, _ in rows], dtype=np.int64)
            collection[f"clip_ids_{split}"] = np.asarray([clip for _, _, clip in rows])
            collection[f"source_labels_{split}"] = np.asarray(["outside" if target < 0 else ("hello", "thanks")[target] for _, target, _ in rows])
            collection[f"signer_ids_{split}"] = np.asarray([-1 if missing_signer and signer == 6 and target >= 0 else signer for signer, target, _ in rows], dtype=np.int64)
    graph_path, legacy_path = root / "graph.npz", root / "legacy.npz"
    np.savez_compressed(graph_path, **graph)
    np.savez_compressed(legacy_path, **legacy)
    graph_meta = {"signLanguage": "asl", "language": "asl", "featureContract": CONTRACT_ID,
                  "contractHash": contract_hash(), "adjacencyHash": adjacency_hash(), "featuresStandardized": False,
                  "preparedDataSha256": sha256_file(graph_path), "sources": {"sha256": {"legacyPrepared": sha256_file(legacy_path)}},
                  "normalization": fit_normalization(graph["X_train"], graph["mask_train"])}
    legacy_meta = {"signLanguage": "asl", "language": "asl", "preprocessing": {"contract": "signbridge-pose27-xyc-v1", "frames": 32, "joints": JOINTS, "mirroring": False}}
    graph_path.with_suffix(".metadata.json").write_text(json.dumps(graph_meta))
    legacy_path.with_suffix(".metadata.json").write_text(json.dumps(legacy_meta))
    return graph_path, legacy_path, graph, legacy


class SignerStudyTests(unittest.TestCase):
    def test_group_assignment_is_deterministic_numeric_sorted_and_disjoint(self):
        groups = assign_signers(list(range(10)))
        self.assertEqual(groups, assign_signers(list(reversed(range(10)))))
        self.assertEqual([len(groups[name]) for name in ("train", "val", "test")], [7, 1, 2])
        self.assertEqual(len(set(groups["train"]) & set(groups["test"])), 0)
        self.assertEqual(set(sum(groups.values(), [])), set(range(10)))
        with self.assertRaisesRegex(ValueError, "seven"):
            assign_signers([0, 1, 2])

    def test_paired_study_is_compatible_with_training_loader_and_keeps_unknowns(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, original_graph, original_legacy = sources(root)
            input_paths = [graph_path, legacy_path, graph_path.with_suffix(".metadata.json"), legacy_path.with_suffix(".metadata.json")]
            before = {path: sha256_file(path) for path in input_paths}
            output = root / "study"
            report = prepare_study(graph_path, legacy_path, output)
            with np.load(output / "asl.npz", allow_pickle=False) as graph, np.load(output / "asl-legacy.npz", allow_pickle=False) as legacy:
                signer_groups = {split: set(graph[f"signer_ids_{split}"].tolist()) for split in ("train", "val", "test")}
                self.assertFalse(signer_groups["train"] & signer_groups["test"])
                self.assertFalse(signer_groups["train"] & signer_groups["val"])
                for split in SPLITS:
                    np.testing.assert_array_equal(graph[f"clip_ids_{split}"], legacy[f"clip_ids_{split}"])
                    np.testing.assert_array_equal(graph[f"y_{split}"], legacy[f"y_{split}"])
                for split in ("unknown_validation", "unknown_test"):
                    for name in ("X", "y", "clip_ids", "source_labels", "signer_ids"):
                        np.testing.assert_array_equal(graph[f"{name}_{split}"], original_graph[f"{name}_{split}"])
                        np.testing.assert_array_equal(legacy[f"{name}_{split}"], original_legacy[f"{name}_{split}"])
            labels, metadata, arrays, normalization, legacy_normalization = load_data(output / "asl.npz", "asl", output / "asl-legacy.npz")
            self.assertEqual(labels, ["HELLO", "THANKS"])
            self.assertEqual(normalization["fitSplit"], "train")
            old_meta = json.loads((output / "asl-legacy.metadata.json").read_text())
            np.testing.assert_array_equal(old_meta["normalization"]["mean"], legacy_normalization["mean"])
            self.assertEqual(report["knownSignerOverlap"], {"trainValidation": 0, "trainTest": 0, "validationTest": 0})
            self.assertEqual(report["unknownValidationTestSignerOverlap"], 2)
            self.assertIs(report["trained"], False)
            self.assertNotIn("signerGroups", json.dumps(report))
            self.assertNotIn("knownClipIds", json.dumps(report))
            self.assertEqual(before, {path: sha256_file(path) for path in input_paths})
            with self.assertRaisesRegex(ValueError, "exists"):
                prepare_study(graph_path, legacy_path, output)

    def test_manifest_assignment_hash_reproduces_without_output_path_dependence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, _, _ = sources(root)
            first = prepare_study(graph_path, legacy_path, root / "first")
            second = prepare_study(graph_path, legacy_path, root / "second")
            self.assertEqual(first["assignmentManifestHash"], second["assignmentManifestHash"])

    def test_missing_known_signer_is_not_fabricated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, _, _ = sources(root, missing_signer=True)
            with self.assertRaisesRegex(ValueError, "unavailable"):
                prepare_study(graph_path, legacy_path, root / "study")
            self.assertFalse((root / "study").exists())

    def test_incomplete_new_class_coverage_fails_instead_of_dropping_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, _, _ = sources(root, sparse_class=True)
            with self.assertRaisesRegex(ValueError, "full class coverage"):
                prepare_study(graph_path, legacy_path, root / "study")
            self.assertFalse((root / "study").exists())

    def test_changed_source_hash_fails_before_publishing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, _, _ = sources(root)
            metadata_path = graph_path.with_suffix(".metadata.json")
            metadata = json.loads(metadata_path.read_text())
            metadata["preparedDataSha256"] = "0" * 64
            metadata_path.write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, "hash changed"):
                prepare_study(graph_path, legacy_path, root / "study")
            self.assertFalse((root / "study").exists())

    def test_strict_assignment_moves_whole_signers_and_discards_train_or_missing(self):
        known = {"train": [2], "val": [1], "test": [3]}
        signers = np.asarray([2, 1, 3, -1, 10, 11, 12, 10, 11, 12], dtype=np.int64)
        assignments, discarded, extra = assign_strict_negatives(signers, known)
        self.assertEqual(extra, assign_strict_negatives(signers[::-1], known)[2])
        self.assertEqual(len(extra["val"]), 1)
        self.assertEqual(len(extra["test"]), 2)
        self.assertFalse(set(extra["val"]) & set(extra["test"]))
        self.assertTrue(discarded["knownTrainingSigner"][0])
        self.assertTrue(discarded["missingSignerIdentity"][3])
        self.assertTrue(assignments["unknown_validation"][1])
        self.assertTrue(assignments["unknown_test"][2])
        for signer in (10, 11, 12):
            assigned = assignments["unknown_validation"][signers == signer]
            self.assertTrue(assigned.all() or not assigned.any())
        with self.assertRaisesRegex(ValueError, "overlap"):
            assign_strict_negatives(signers, {"train": [1], "val": [1], "test": [3]})

    def test_strict_preparation_requires_previously_recorded_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, _, _ = sources(root, strict_pool=True)
            with self.assertRaisesRegex(ValueError, "recorded protocol"):
                prepare_study(graph_path, legacy_path, root / "study", strict_negatives=True)
            self.assertFalse((root / "study").exists())

    def test_strict_study_keeps_known_assignment_and_pairs_all_negative_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, original_graph, _ = sources(root, strict_pool=True)
            paths = [graph_path, legacy_path, graph_path.with_suffix(".metadata.json"), legacy_path.with_suffix(".metadata.json")]
            before = {path: sha256_file(path) for path in paths}
            old_report = prepare_study(graph_path, legacy_path, root / "original")
            protocol = root / "protocol.json"
            record_strict_protocol(graph_path, legacy_path, protocol)
            output = root / "strict"
            report = prepare_study(graph_path, legacy_path, output, strict_negatives=True, protocol_path=protocol)
            self.assertEqual(report["groups"], old_report["groups"])
            self.assertEqual(report["status"], "prepared")
            self.assertTrue(report["fullySignerDisjointAcceptanceEvaluation"])
            self.assertFalse(report["unknownClipsUnchanged"])
            self.assertEqual(report["selectionAndTestSignerOverlap"], 0)
            self.assertEqual(report["unknownValidationTestSignerOverlap"], 0)
            self.assertEqual(report["knownTestSignerOverlapThroughUnknownValidation"], 0)
            accounting = report["negativePoolAccounting"]
            self.assertEqual(accounting["pooledClips"], 132)
            self.assertEqual(accounting["retainedClips"], {"unknown_validation": 20, "unknown_test": 40})
            self.assertEqual(accounting["discardedClips"], {"knownTrainingSigner": 70, "missingSignerIdentity": 2})
            self.assertEqual(sum(accounting["retainedClips"].values()) + sum(accounting["discardedClips"].values()), accounting["pooledClips"])
            self.assertEqual(report["sharedUnknownWords"], 1)
            self.assertTrue(report["negativeHoldoutSize"]["unknown_test"]["planningBoundNotMeasuredResult"])
            with np.load(root / "original/asl.npz", allow_pickle=False) as prior, np.load(output / "asl.npz", allow_pickle=False) as graph, np.load(output / "asl-legacy.npz", allow_pickle=False) as legacy:
                for split in ("train", "val", "test"):
                    for field in ("X", "y", "clip_ids", "source_labels", "signer_ids", "mask"):
                        np.testing.assert_array_equal(prior[f"{field}_{split}"], graph[f"{field}_{split}"])
                for split in SPLITS:
                    for field in ("clip_ids", "source_labels", "signer_ids", "y"):
                        np.testing.assert_array_equal(graph[f"{field}_{split}"], legacy[f"{field}_{split}"])
                selected_signers = set().union(*(set(graph[f"signer_ids_{split}"].tolist()) for split in ("train", "val", "unknown_validation")))
                test_signers = set().union(*(set(graph[f"signer_ids_{split}"].tolist()) for split in ("test", "unknown_test")))
                self.assertFalse(selected_signers & test_signers)
                for split in ("unknown_validation", "unknown_test"):
                    source_rows = {identity: original_graph[f"X_{original_split}"][index]
                                   for original_split in ("unknown_validation", "unknown_test")
                                   for index, identity in enumerate(original_graph[f"clip_ids_{original_split}"])}
                    for identity, feature in zip(graph[f"clip_ids_{split}"], graph[f"X_{split}"]):
                        np.testing.assert_array_equal(feature, source_rows[identity])
            labels, metadata, arrays, normalization, old_normalization = load_data(output / "asl.npz", "asl", output / "asl-legacy.npz")
            self.assertEqual(labels, ["HELLO", "THANKS"])
            self.assertEqual(len(arrays["unknown_validation"]["features"]), 20)
            self.assertTrue(metadata["strictNegatives"])
            np.testing.assert_array_equal(normalization["mean"], metadata["normalization"]["mean"])
            self.assertEqual(before, {path: sha256_file(path) for path in paths})
            for private_name in ("knownClipIds", "discardedUnknownClipIds", "signerGroups"):
                self.assertNotIn(private_name, json.dumps(report))
            with self.assertRaisesRegex(ValueError, "exists"):
                prepare_study(graph_path, legacy_path, output, strict_negatives=True, protocol_path=protocol)

    def test_insufficient_strict_negatives_record_unavailability_without_npz(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, _, _ = sources(root)
            protocol = root / "protocol.json"
            record_strict_protocol(graph_path, legacy_path, protocol)
            output = root / "strict"
            report = prepare_study(graph_path, legacy_path, output, strict_negatives=True, protocol_path=protocol)
            self.assertEqual(report["status"], "unavailable")
            self.assertFalse(report["studyAvailable"])
            self.assertFalse(report["fullySignerDisjointAcceptanceEvaluation"])
            self.assertTrue(report["signerDisjointPartitionVerified"])
            self.assertEqual(len(report["unavailableReasons"]), 2)
            self.assertFalse(list(output.glob("*.npz")))
            self.assertTrue((output / "study-unavailable.metadata.json").is_file())

    def test_changed_strict_protocol_is_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, _, _ = sources(root, strict_pool=True)
            protocol = root / "protocol.json"
            recorded = record_strict_protocol(graph_path, legacy_path, protocol)
            recorded["minimumNegativesPerHoldout"] = 1
            protocol.write_text(json.dumps(recorded))
            with self.assertRaisesRegex(ValueError, "protocol"):
                prepare_study(graph_path, legacy_path, root / "study", strict_negatives=True, protocol_path=protocol)
            self.assertFalse((root / "study").exists())

    def test_strict_assignment_reproduces_with_same_frozen_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path, legacy_path, _, _ = sources(root, strict_pool=True)
            protocol = root / "protocol.json"
            record_strict_protocol(graph_path, legacy_path, protocol)
            first = prepare_study(graph_path, legacy_path, root / "first", strict_negatives=True, protocol_path=protocol)
            second = prepare_study(graph_path, legacy_path, root / "second", strict_negatives=True, protocol_path=protocol)
            self.assertEqual(first["assignmentManifestHash"], second["assignmentManifestHash"])
            self.assertEqual(first["dataHashes"], second["dataHashes"])


if __name__ == "__main__":
    unittest.main()
