"""Synthetic source tests: no network and no real videos/features needed."""
from collections import Counter
import csv
import io
import json
from pathlib import Path
import tempfile
import struct
import unittest
from unittest.mock import patch
import zipfile

import numpy as np

from training import fetch_tasks_study as subject


def fixture(root):
    (root / "metadata").mkdir(parents=True)
    (root / "prepared").mkdir()
    (root / "camera-study-references-2026-10-11").mkdir()
    rows = {"train": [], "test": []}
    partitions = {split: [] for split in subject.PARTITIONS}
    known = []
    def row(clip, word):
        return {"FilePath": clip, "Word": word, "Category": clip.split("/")[0], "Video": Path(clip).name}
    for word, label, maximum in subject.FOCUS:
        category = "People" if label == "FATHER" else "Greetings"
        known.append(word)
        training = [f"{category}/{word}/MVI_{100+i:04}.MOV" for i in range(10)]
        validation = [f"{category}/{word}/MVI_{8000+i:04}.MOV" for i in range(2 if label in ("HELLO", "THANK YOU") else 3)]
        if label == "HELLO":
            validation[0] = "Greetings/48. Hello/MVI_9917.MOV"
        if label == "THANK YOU":
            validation[0] = "Greetings/55. Thank you/MVI_0008.MOV"
        testing = [f"{category}/{word}/MVI_{9000+i:04}.MOV" for i in range(3)]
        partitions["train"].extend(training)
        partitions["val"].extend(validation)
        partitions["test"].extend(testing)
        rows["train"].extend(row(clip, word) for clip in training + validation)
        rows["test"].extend(row(clip, word) for clip in testing)
    prior_ids = [partitions["train"][0], partitions["train"][1], partitions["test"][0], partitions["test"][3]]
    prior = {"clips": [{"clip_id": clip} for clip in prior_ids]}
    (root / "camera-study-references-2026-10-11/manifest.json").write_text(json.dumps(prior), encoding="utf8")
    for split in ("train", "test"):
        with (root / f"metadata/{split}_include50.csv").open("w", newline="") as source:
            writer = csv.DictWriter(source, fieldnames=["FilePath", "Word", "Category", "Video"])
            writer.writeheader(); writer.writerows(rows[split])
    # Deliberately different full-INCLUDE assignments: existing known benchmark
    # identities must remain with their original INCLUDE50 recording split.
    moved = rows["train"].pop(0)
    rows["test"].append(moved)
    for word in subject.UNSUPPORTED_GREETINGS:
        for split, start, count in (("train", 0, 9), ("test", 1000, 6)):
            generated = [f"Greetings/{word}/MVI_{start+i:04}.MOV" for i in range(count)]
            rows[split].extend(row(clip, word) for clip in generated)
        partitions["unknown_validation"].append(f"Greetings/{word}/MVI_0000.MOV")
        partitions["unknown_test"].append(f"Greetings/{word}/MVI_1000.MOV")
    for split in ("train", "test"):
        with (root / f"metadata/{split}_include.csv").open("w", newline="") as source:
            writer = csv.DictWriter(source, fieldnames=["FilePath", "Word", "Category", "Video"])
            writer.writeheader(); writer.writerows(rows[split])
    np.savez(root / "prepared/isl.npz", raw_labels=np.array(known), labels=np.array([label for _, label, _ in subject.FOCUS]),
             **{f"clip_ids_{split}": np.array(ids) for split, ids in partitions.items()})
    return partitions, prior_ids


class MemoryFetcher:
    def __init__(self, archives, blobs, max_bytes=subject.MAX_NETWORK_BYTES):
        self.archives, self.blobs, self.max_bytes = archives, blobs, max_bytes
        self.bytes_downloaded = 0
        self.calls = []

    def fetch(self, name, start, end):
        self.calls.append((name, start, end))
        value = self.blobs[name][start:end+1]
        if len(value) != end-start+1:
            raise ValueError("Invalid test range")
        self.bytes_downloaded += len(value)
        return value


def source_fixture(rows):
    archives, blobs = [], {}
    for category, count in (("Greetings", 2), ("People", 5)):
        for number in range(1, count+1):
            name = f"{category}_{number}of{count}.zip"
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("dummy.txt", b"test directory")
                if number == 1:
                    for row in rows:
                        if row["category"] == category:
                            archive.writestr(row["clip_id"], row["clip_id"].encode()*10)
            blobs[name] = buffer.getvalue()
            archives.append({"key": name, "size": len(blobs[name]), "checksum": "md5:"+"a"*32,
                             "links": {"content": f"https://zenodo.org/api/records/4010759/files/{name}/content"}})
    record = {"id": 4010759, "metadata": {"license": {"id": "cc-by-4.0"}}, "files": archives}
    return record, json.dumps(record).encode(), blobs


class TasksStudyTests(unittest.TestCase):
    def setUp(self):
        quiet = patch("builtins.print")
        quiet.start()
        self.addCleanup(quiet.stop)

    def test_deterministic_known_recording_and_unknown_word_disjointness(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/".training-data"
            partitions, excluded = fixture(root)
            rows, provenance = subject.select_study(root)
            self.assertEqual(Counter(row["split"] for row in rows), {"train": 22, "val": 6, "test": 8, "unknown_train": 12, "unknown_val": 6, "unknown_test": 6})
            self.assertEqual(len(rows), 60)
            self.assertFalse(set(excluded+list(subject.LEGACY_REFERENCES)) & {row["clip_id"] for row in rows})
            unknown_words = {role: {row["label"] for row in rows if row["split"] == role} for role in ("unknown_train", "unknown_val", "unknown_test")}
            self.assertFalse(unknown_words["unknown_train"] & unknown_words["unknown_val"])
            self.assertFalse(unknown_words["unknown_train"] & unknown_words["unknown_test"])
            self.assertFalse(unknown_words["unknown_val"] & unknown_words["unknown_test"])
            self.assertNotIn("UNKNOWN", set.union(*unknown_words.values()))
            reserved = set.union(*(set(ids) for ids in partitions.values()))
            self.assertTrue(all(row["clip_id"] not in reserved for row in rows if row["split"].startswith("unknown_")))
            self.assertTrue(all(row["clip_id"] in partitions[row["split"]] for row in rows if not row["split"].startswith("unknown_")))
            self.assertEqual(subject.select_study(root), (rows, provenance))

    def test_insufficient_unknowns_fails_instead_of_borrowing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/".training-data"
            fixture(root)
            path = root/"metadata/train_include.csv"
            rows = subject.read_csv(path)
            rows = [row for row in rows if row["Word"] != "53. Good evening" or row["FilePath"].endswith("MVI_0000.MOV")]
            with path.open("w", newline="") as source:
                writer = csv.DictWriter(source, fieldnames=rows[0].keys()); writer.writeheader(); writer.writerows(rows)
            with self.assertRaisesRegex(ValueError, "Insufficient fresh"):
                subject.select_study(root)

    def test_archive_allowlist_comes_from_record_and_requires_all_parts(self):
        record, _, _ = source_fixture([])
        archives = subject.archives_from_record(record, {"Greetings", "People"})
        self.assertEqual(len(archives), 7)
        record["files"].pop()
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            subject.archives_from_record(record, {"Greetings", "People"})

    def test_current_zenodo_self_content_link_supported_but_other_host_rejected(self):
        record, _, _ = source_fixture([])
        for source in record["files"]:
            source["links"] = {"self": source["links"]["content"]}
        self.assertEqual(len(subject.archives_from_record(record, {"Greetings", "People"})), 7)
        record["files"][0]["links"]["self"] = "https://example.com/large.zip"
        with self.assertRaisesRegex(ValueError, "metadata is incomplete or unexpected"):
            subject.archives_from_record(record, {"Greetings", "People"})

    def test_freeze_then_download_manifest_and_verified_resume(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/".training-data"
            fixture(root)
            selected, _ = subject.select_study(root)
            record, raw, blobs = source_fixture(selected)
            factory = lambda archives, **kwargs: MemoryFetcher(archives, blobs, **kwargs)
            output = root/"tasks-study"
            plan, path = subject.freeze_plan(root, output, lambda:(record, raw), factory)
            frozen_hash = subject.digest_file(path)
            self.assertFalse((output/"manifest.json").exists())
            self.assertFalse(any(output.glob("*.MOV")))
            with patch("builtins.print"):
                progress = subject.download_plan(root, output, factory)
            self.assertTrue(progress["complete"])
            self.assertEqual(subject.digest_file(path), frozen_hash)
            final = json.loads((output/"manifest.json").read_text())
            self.assertEqual(final["format"], "signbridge-tasks-video-study-manifest-v1")
            self.assertEqual(final["frozenPlanSha256"], frozen_hash)
            self.assertEqual(len(final["clips"]), len(selected))
            self.assertTrue(all(Path(row["localFile"]).name == row["localFile"] and row["sha256"] for row in final["clips"]))
            self.assertTrue(all(row["label"] != "UNKNOWN" for row in final["clips"]))
            subject.download_plan(root, output, factory)
            (output/final["clips"][0]["localFile"]).write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "hash or size changed"):
                subject.download_plan(root, output, factory)

    def test_compressed_and_disk_budgets_checked_before_video_download(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/".training-data"
            fixture(root)
            selected, _ = subject.select_study(root)
            record, raw, blobs = source_fixture(selected)
            factory = lambda archives, **kwargs: MemoryFetcher(archives, blobs, **kwargs)
            with patch.object(subject, "MAX_SELECTED_BYTES", 10):
                with self.assertRaisesRegex(subject.BudgetExceeded, "900 MiB"):
                    subject.freeze_plan(root, root/"tasks-study", lambda:(record, raw), factory)
            self.assertFalse((root/"tasks-study/plan.json").exists())

    def test_output_boundary(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                subject.checked_output(Path(folder)/".training-data", Path(folder)/"public")

    @patch.object(subject.time, "sleep")
    def test_range_rejected_before_read_and_actual_payload_budget(self, _sleep):
        class Response:
            def __init__(self, status, body=b"1234567890"):
                self.status, self.body, self.offset, self.read_calls = status, body, 0, 0
                self.headers = {"Content-Range": "bytes 0-9/10"}
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, count):
                self.read_calls += 1
                data=self.body[self.offset:self.offset+count];self.offset+=len(data);return data
        archives={"test.zip":{"bytes":10,"url":"https://zenodo.org/test"}}
        denied=Response(200)
        with self.assertRaises(ValueError):
            subject.RangeFetcher(archives, lambda *args,**kwargs:denied).fetch("test.zip",0,9)
        self.assertEqual(denied.read_calls,0)
        allowed=Response(206)
        fetcher=subject.RangeFetcher(archives,lambda *args,**kwargs:allowed,max_bytes=5)
        with self.assertRaises(subject.BudgetExceeded):
            fetcher.fetch("test.zip",0,9)
        self.assertEqual(fetcher.bytes_downloaded,5)

    def test_exact_network_budget_accepts_last_complete_range(self):
        class Response:
            status = 206
            headers = {"Content-Range": "bytes 0-9/10", "Content-Length": "10"}
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, count): return b"0123456789"[:count]
        fetcher = subject.RangeFetcher({"test.zip": {"bytes": 10, "url": "https://zenodo.org/test"}},
                                       lambda *args, **kwargs: Response(), max_bytes=10)
        self.assertEqual(fetcher.fetch("test.zip", 0, 9), b"0123456789")
        self.assertEqual(fetcher.bytes_downloaded, 10)

    @patch.object(subject.time, "sleep")
    def test_retry_bytes_count_towards_total(self, _sleep):
        class Response:
            status = 206
            headers = {"Content-Range": "bytes 0-9/10"}
            def __init__(self): self.offset = 0
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, count):
                if self.offset: raise OSError("broken response")
                self.offset += min(5, count)
                return b"12345"[:count]
        fetcher = subject.RangeFetcher({"test.zip": {"bytes": 10, "url": "https://zenodo.org/test"}},
                                       lambda *args, **kwargs: Response(), max_bytes=12)
        with self.assertRaises(subject.BudgetExceeded):
            fetcher.fetch("test.zip", 0, 9)
        self.assertEqual(fetcher.bytes_downloaded, 12)

    def test_failed_plan_directory_bytes_survive_replanning(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/".training-data"
            fixture(root)
            selected, _ = subject.select_study(root)
            record, raw, blobs = source_fixture(selected)
            output = root/"tasks-study"
            class FailingFetcher(MemoryFetcher):
                def fetch(self, name, start, end):
                    super().fetch(name, start, end)
                    raise ValueError("directory unavailable")
            with self.assertRaisesRegex(ValueError, "directory unavailable"):
                subject.freeze_plan(root, output, lambda:(record, raw),
                                    lambda archives, **kwargs: FailingFetcher(archives, blobs, **kwargs))
            earlier = json.loads((output/"planning-downloads.json").read_text())["metadata_payload_received_bytes"]
            self.assertGreater(earlier, len(raw))
            plan, _ = subject.freeze_plan(root, output, lambda:(record, raw),
                                         lambda archives, **kwargs: MemoryFetcher(archives, blobs, **kwargs))
            self.assertGreater(plan["budgets"]["metadata_payload_received_bytes"], earlier + len(raw))

    def test_corrupt_resume_counter_rejected_before_fetch(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/".training-data"
            fixture(root)
            selected, _ = subject.select_study(root)
            record, raw, blobs = source_fixture(selected)
            output = root/"tasks-study"
            factory = lambda archives, **kwargs: MemoryFetcher(archives, blobs, **kwargs)
            _, path = subject.freeze_plan(root, output, lambda:(record, raw), factory)
            (output/"downloads.json").write_text(json.dumps({"plan_sha256": subject.digest_file(path), "clips": {},
                                                           "video_range_payload_received_bytes": -1}))
            with self.assertRaisesRegex(ValueError, "Invalid frozen download progress"):
                subject.download_plan(root, output, factory)

    def test_frozen_plan_tamper_rejected_before_fetch(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/".training-data"
            fixture(root)
            selected, _ = subject.select_study(root)
            record, raw, blobs = source_fixture(selected)
            output = root/"tasks-study"
            factory = lambda archives, **kwargs: MemoryFetcher(archives, blobs, **kwargs)
            plan, path = subject.freeze_plan(root, output, lambda:(record, raw), factory)
            plan["clips"][0]["split"] = "test"
            path.write_text(subject.stable_json(plan))
            with self.assertRaisesRegex(ValueError, "Frozen plan hash changed"):
                subject.download_plan(root, output, factory)

    def test_cached_official_index_tamper_rejected_before_replanning(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/".training-data"
            fixture(root)
            selected, _ = subject.select_study(root)
            record, raw, blobs = source_fixture(selected)
            output = root/"tasks-study"
            factory = lambda archives, **kwargs: MemoryFetcher(archives, blobs, **kwargs)
            _, path = subject.freeze_plan(root, output, lambda:(record, raw), factory)
            path.unlink()
            (output/"plan.sha256").unlink()
            next((output/"archive-indexes").glob("*.json")).write_text("{}")
            with self.assertRaisesRegex(ValueError, "Cached official ZIP index hash changed"):
                subject.freeze_plan(root, output, lambda:(record, raw), factory)

    def local_member_fixture(self, payload=b"real-selected-video-bytes", compression=zipfile.ZIP_STORED):
        name = "Greetings/48. Hello/MVI_0001.MOV"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=compression) as archive:
            info = zipfile.ZipInfo(name)
            info.compress_type = compression
            info.extra = struct.pack("<HH", 0xCAFE, 8) + b"12345678"
            archive.writestr(info, payload)
            archive.writestr("neighbour.txt", b"never-a-training-member" * 100)
        blob = buffer.getvalue()
        archives = {"Greetings_1of2.zip": {"bytes": len(blob), "url": "https://zenodo.org/test"}}
        fetcher = MemoryFetcher(archives, {"Greetings_1of2.zip": blob})
        row = subject.read_index(fetcher, "Greetings_1of2.zip")[name]
        fetcher.calls.clear()
        fetcher.bytes_downloaded = 0
        return fetcher, row, payload

    def test_one_span_real_zip_extra_and_trailing_bytes_decode_only_selected_member(self):
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            fetcher, row, payload = self.local_member_fixture(compression=compression)
            self.assertEqual(subject.fetch_study_member(fetcher, "Greetings_1of2.zip", row), payload)
            self.assertEqual(len(fetcher.calls), 1)
            self.assertGreater(fetcher.bytes_downloaded, row["compressed_bytes"] + 30 + len(row["name"]))

    def test_single_span_header_crc_sizes_name_and_method_tampering_rejected(self):
        for byte_offset in (6, 8, 14, 18, 22, 26, 30):
            fetcher, row, _ = self.local_member_fixture()
            blob = bytearray(fetcher.blobs["Greetings_1of2.zip"])
            blob[row["local_offset"] + byte_offset] ^= 1
            fetcher.blobs["Greetings_1of2.zip"] = bytes(blob)
            with self.assertRaises(ValueError):
                subject.fetch_study_member(fetcher, "Greetings_1of2.zip", row)

    def test_single_span_payload_crc_and_truncation_rejected(self):
        fetcher, row, _ = self.local_member_fixture()
        blob = bytearray(fetcher.blobs["Greetings_1of2.zip"])
        data_start = row["local_offset"] + 30 + len(row["name"]) + 12
        blob[data_start] ^= 1
        fetcher.blobs["Greetings_1of2.zip"] = bytes(blob)
        with self.assertRaisesRegex(ValueError, "CRC32 mismatch"):
            subject.fetch_study_member(fetcher, "Greetings_1of2.zip", row)
        fetcher, row, _ = self.local_member_fixture()
        truncated = fetcher.blobs["Greetings_1of2.zip"][:data_start+2]
        fetcher.blobs["Greetings_1of2.zip"] = truncated
        fetcher.archives["Greetings_1of2.zip"]["bytes"] = len(truncated)
        with self.assertRaisesRegex(ValueError, "Truncated selected ZIP member span"):
            subject.fetch_study_member(fetcher, "Greetings_1of2.zip", row)

    def test_three_range_fallback_retains_header_extra_and_crc_checks(self):
        fetcher, row, payload = self.local_member_fixture()
        with patch.object(subject, "MAX_MEMBER_BYTES", 100):
            self.assertEqual(subject.fetch_study_member(fetcher, "Greetings_1of2.zip", row), payload)
        self.assertEqual(len(fetcher.calls), 3)
        self.assertEqual(fetcher.bytes_downloaded, 30 + len(row["name"]) + 12 + row["compressed_bytes"])

    def test_data_descriptor_zero_local_fields_allowed_but_other_numbers_rejected(self):
        fetcher, row, payload = self.local_member_fixture()
        blob = bytearray(fetcher.blobs["Greetings_1of2.zip"])
        row["flags"] |= 8
        struct.pack_into("<H", blob, row["local_offset"] + 6, row["flags"])
        struct.pack_into("<III", blob, row["local_offset"] + 14, 0, 0, 0)
        fetcher.blobs["Greetings_1of2.zip"] = bytes(blob)
        self.assertEqual(subject.fetch_study_member(fetcher, "Greetings_1of2.zip", row), payload)
        struct.pack_into("<I", blob, row["local_offset"] + 14, 123)
        fetcher.blobs["Greetings_1of2.zip"] = bytes(blob)
        with self.assertRaisesRegex(ValueError, "CRC or size mismatch"):
            subject.fetch_study_member(fetcher, "Greetings_1of2.zip", row)


if __name__ == "__main__":
    unittest.main()
