"""Bounded-source tests use generated ZIP bytes; no research videos or network."""
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import numpy as np

from training import fetch_include_reference as subject


class Response:
    def __init__(self, status, headers, body):
        self.status, self.headers, self.body = status, headers, body
        self.read_calls = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        self.read_calls.append(limit)
        return self.body[:limit]


class MemoryFetcher:
    def __init__(self, archives):
        self.archives, self.bytes_downloaded, self.ranges = archives, 0, []

    def fetch(self, name, start, end):
        value = self.archives[name][start:end + 1]
        if len(value) != end - start + 1:
            raise ValueError("Test attempted an out-of-bounds range")
        self.bytes_downloaded += len(value)
        self.ranges.append((name, start, end))
        return value


def make_archive(members, method=zipfile.ZIP_DEFLATED):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=method) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return output.getvalue()


def make_splits(root):
    (root / "metadata").mkdir(parents=True)
    (root / "prepared").mkdir()
    train = [f"Greetings/48. Hello/MVI_{i:04}.MOV" for i in (4, 2, 1)]
    test = ["Greetings/48. Hello/MVI_0003.MOV", "Greetings/55. Thank you/MVI_0006.MOV"]
    for name, ids in (("train", train), ("test", test)):
        with (root / f"metadata/{name}_include50.csv").open("w", newline="") as destination:
            writer = csv.DictWriter(destination, fieldnames=["FilePath", "Word"])
            writer.writeheader()
            for clip in ids:
                writer.writerow({"FilePath": clip, "Word": clip.split("/")[1]})
    np.savez(root / "prepared/isl.npz", clip_ids_train=np.array(train[:2]), clip_ids_val=np.array(train[2:]), clip_ids_test=np.array(test))
    return train, test


class BoundedSourceTests(unittest.TestCase):
    @patch.object(subject.time, "sleep")
    def test_ignored_range_rejected_before_body_read(self, _sleep):
        response = Response(200, {}, b"large body must not be read")
        with self.assertRaisesRegex(ValueError, "exact bounded"):
            subject.BoundedFetcher(lambda *args, **kwargs: response).fetch("Greetings_1of2.zip", 0, 3)
        self.assertEqual(response.read_calls, [])

    @patch.object(subject.time, "sleep")
    def test_wrong_range_or_encoding_rejected_before_body_read(self, _sleep):
        total = subject.ARCHIVES["Greetings_1of2.zip"]["bytes"]
        for headers in ({"Content-Range": f"bytes 0-4/{total}"}, {"Content-Range": f"bytes 0-3/{total}", "Content-Encoding": "gzip"}):
            response = Response(206, headers, b"abcd")
            with self.assertRaises(ValueError):
                subject.BoundedFetcher(lambda *args, **kwargs: response).fetch("Greetings_1of2.zip", 0, 3)
            self.assertEqual(response.read_calls, [])

    @patch.object(subject.time, "sleep")
    def test_range_exact_length_and_request(self, _sleep):
        total = subject.ARCHIVES["Greetings_1of2.zip"]["bytes"]
        seen = []
        response = Response(206, {"Content-Range": f"bytes 5-8/{total}"}, b"abcd")
        def opener(request, **kwargs):
            seen.append(request)
            return response
        fetcher = subject.BoundedFetcher(opener)
        self.assertEqual(fetcher.fetch("Greetings_1of2.zip", 5, 8), b"abcd")
        self.assertEqual(fetcher.bytes_downloaded, 4)
        self.assertEqual(seen[0].get_header("Range"), "bytes=5-8")
        self.assertEqual(response.read_calls, [5])
        response.body = b"abc"
        with self.assertRaisesRegex(ValueError, "size mismatch"):
            fetcher.fetch("Greetings_1of2.zip", 5, 8)

    def test_allowlist_and_range_bounds(self):
        fetcher = subject.BoundedFetcher(lambda *args, **kwargs: self.fail("Network must not be called"))
        for name, start, end in (("other.zip", 0, 2), ("Greetings_1of2.zip", -1, 2), ("Greetings_1of2.zip", 2, 1), ("Greetings_1of2.zip", 0, subject.MAX_MEMBER_BYTES)):
            with self.assertRaises(ValueError):
                fetcher.fetch(name, start, end)

    def test_selected_deflate_and_stored_members_match_original_crc(self):
        name, content = "Greetings/48. Hello/MVI_0002.MOV", b"video bytes" * 200
        for method in (zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED):
            data = make_archive({name: content}, method)
            with patch.dict(subject.ARCHIVES, {"test.zip": {"bytes": len(data), "md5": "unused"}}, clear=True):
                fetcher = MemoryFetcher({"test.zip": data})
                directory = subject.read_directory(fetcher, "test.zip")
                self.assertEqual(subject.fetch_member(fetcher, "test.zip", directory[name]), content)
                self.assertLessEqual(max(end - start + 1 for _, start, end in fetcher.ranges), subject.MAX_MEMBER_BYTES)

    def test_crc_tamper_and_truncated_directory_rejected(self):
        name = "Greetings/48. Hello/MVI_0002.MOV"
        data = make_archive({name: b"original video bytes"}, zipfile.ZIP_STORED)
        with patch.dict(subject.ARCHIVES, {"test.zip": {"bytes": len(data), "md5": "unused"}}, clear=True):
            fetcher = MemoryFetcher({"test.zip": data})
            row = subject.read_directory(fetcher, "test.zip")[name]
            row["crc32"] ^= 1
            with self.assertRaisesRegex(ValueError, "CRC32"):
                subject.fetch_member(fetcher, "test.zip", row)
        with self.assertRaises(ValueError):
            subject.parse_directory(b"PK\x01\x02")

    def test_selection_uses_lexicographic_train_identity_excludes_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / ".training-data"
            train, test = make_splits(root)
            rows, provenance = subject.select_references(root)
            self.assertEqual([row["clip_id"] for row in rows], [train[1], train[0], *test])
            self.assertNotIn(train[2], [row["clip_id"] for row in rows])
            self.assertEqual([row["split"] for row in rows], ["train", "train", "official_test", "official_test"])
            self.assertIn("no predictions", provenance["selection"])

    def test_split_overlap_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / ".training-data"
            train, test = make_splits(root)
            np.savez(root / "prepared/isl.npz", clip_ids_train=np.array(train), clip_ids_val=np.array(train[2:]), clip_ids_test=np.array(test))
            with self.assertRaisesRegex(ValueError, "overlap"):
                subject.select_references(root)

    def test_output_must_stay_under_ignored_research_root(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / ".training-data"
            with self.assertRaisesRegex(ValueError, "child"):
                subject.fetch_references(root, Path(folder) / "public")

    def test_manifest_frozen_before_download_and_verified_reuse(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / ".training-data"
            make_splits(root)
            rows, _ = subject.select_references(root)
            archive = make_archive({row["clip_id"]: (row["clip_id"].encode() * 20) for row in rows})
            output = root / "references"
            fetcher = MemoryFetcher({"test.zip": archive})
            original_fetch_member = subject.fetch_member
            def check_frozen(*args):
                frozen = json.loads((output / "manifest.json").read_text())
                self.assertFalse(frozen["downloaded"])
                self.assertEqual([row["clip_id"] for row in frozen["clips"]], [row["clip_id"] for row in rows])
                return original_fetch_member(*args)
            with patch.dict(subject.ARCHIVES, {"test.zip": {"bytes": len(archive), "md5": "upstream-not-verified"}}, clear=True), patch.object(subject, "fetch_member", side_effect=check_frozen):
                manifest = subject.fetch_references(root, output, True, fetcher)
                self.assertTrue(manifest["downloaded"])
                self.assertTrue(all(row["crc32_verified"] and row["saved_hash_verified"] for row in manifest["clips"]))
                self.assertFalse(any(row["archive_full_md5_verified"] for row in manifest["clips"]))
                subject.fetch_references(root, output, True, MemoryFetcher({"test.zip": archive}))
                first = output / manifest["clips"][0]["local_file"]
                first.write_bytes(b"tampered")
                with self.assertRaisesRegex(ValueError, "hash or size"):
                    subject.fetch_references(root, output, True, MemoryFetcher({"test.zip": archive}))


if __name__ == "__main__":
    unittest.main()
