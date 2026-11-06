"""No real network: durable quota races and actual small ZIP-member tests."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from training import download_tasks_parallel as subject
from training.test_fetch_tasks_study import fixture, source_fixture, MemoryFetcher


class FakeOpener:
    def __init__(self, blobs):
        self.blobs, self.lock, self.active, self.maximum, self.calls = blobs, threading.Lock(), 0, 0, 0

    def __call__(self, request, timeout=40):
        name = request.full_url.split("/files/", 1)[1].split("/content", 1)[0]
        start, end = map(int, re.fullmatch(r"bytes=(\d+)-(\d+)", request.get_header("Range")).groups())
        blob = self.blobs[name]
        owner = self
        class Response:
            status = 206
            headers = {"Content-Range": f"bytes {start}-{end}/{len(blob)}", "Content-Length": str(end-start+1)}
            def __init__(self): self.offset = start
            def __enter__(self):
                with owner.lock:
                    owner.calls += 1
                    owner.active += 1
                    owner.maximum = max(owner.maximum, owner.active)
                return self
            def __exit__(self, *args):
                with owner.lock: owner.active -= 1
            def read(self, count):
                time.sleep(0.001)
                data = blob[self.offset:min(end+1, self.offset+count)]
                self.offset += len(data)
                return data
        return Response()


class ParallelAcquisitionTests(unittest.TestCase):
    def setUp(self):
        quiet = patch("builtins.print")
        quiet.start()
        self.addCleanup(quiet.stop)

    def study(self, folder):
        root = Path(folder)/".training-data"
        fixture(root)
        selected, _ = subject.base.select_study(root)
        record, raw, blobs = source_fixture(selected)
        output = root/"tasks-study"
        subject.base.freeze_plan(root, output, lambda:(record, raw),
                                 lambda archives, **kwargs: MemoryFetcher(archives, blobs, **kwargs))
        return root, output, blobs

    def test_uncommitted_reservation_survives_restart_and_never_resets_budget(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"quota.json"
            quota = subject.DurableQuota(path, {"study": "one"}, 10, limit=20)
            self.assertEqual(quota.reserve(8), 8)
            resumed = subject.DurableQuota(path, {"study": "one"}, 10, limit=20)
            self.assertEqual(resumed.reserve(5), 2)
            resumed.commit(2, 1)
            self.assertEqual(resumed.snapshot()["parallelChargeBytes"], 9)
            self.assertEqual(resumed.snapshot()["parallelConfirmedBytes"], 1)
            self.assertEqual(resumed.reserve(1), 1)
            with self.assertRaises(subject.base.BudgetExceeded): resumed.reserve(1)
            self.assertEqual(json.loads(path.read_text())["parallelChargeBytes"], 10)

    def test_four_workers_competing_for_one_global_quota_cannot_overrun(self):
        with tempfile.TemporaryDirectory() as folder:
            quota = subject.DurableQuota(Path(folder)/"quota.json", {"study": "one"}, 10, limit=37)
            def read_one(_):
                try:
                    count = quota.reserve(3)
                    time.sleep(0.001)
                    quota.commit(count, count)
                    return count
                except subject.base.BudgetExceeded:
                    return 0
            with ThreadPoolExecutor(max_workers=4) as pool:
                received = sum(pool.map(read_one, range(20)))
            self.assertEqual(received, 27)
            state = quota.snapshot()
            self.assertEqual(state["parallelChargeBytes"], 27)
            self.assertEqual(state["parallelConfirmedBytes"], 27)
            self.assertEqual(state["initialChargeBytes"]+state["parallelChargeBytes"], 37)

    def test_failed_reads_remain_charged_across_retries(self):
        with tempfile.TemporaryDirectory() as folder:
            quota = subject.DurableQuota(Path(folder)/"quota.json", {"study": "one"}, 0, limit=25)
            class Response:
                status = 206
                headers = {"Content-Range": "bytes 0-9/10", "Content-Length": "10"}
                def __enter__(self): return self
                def __exit__(self, *args): return False
                def read(self, count): raise OSError("partial read may have consumed bytes")
            fetcher = subject.QuotaRangeFetcher({"one.zip": {"bytes": 10, "url": "https://zenodo.org/test"}}, quota,
                                               lambda *args, **kwargs: Response())
            with patch.object(quota.stop, "wait", return_value=False):
                with self.assertRaises(OSError): fetcher.fetch("one.zip", 0, 9)
            state = quota.snapshot()
            self.assertEqual(state["parallelChargeBytes"], 25)
            self.assertEqual(state["parallelConfirmedBytes"], 0)
            resumed = subject.DurableQuota(Path(folder)/"quota.json", {"study": "one"}, 0, limit=25)
            with self.assertRaises(subject.base.BudgetExceeded): resumed.reserve(1)

    def test_ignored_range_rejected_before_body_read_or_quota_reservation(self):
        with tempfile.TemporaryDirectory() as folder:
            quota = subject.DurableQuota(Path(folder)/"quota.json", {"study": "one"}, 0, limit=25)
            class Response:
                status = 200
                headers = {}
                reads = 0
                def __enter__(self): return self
                def __exit__(self, *args): return False
                def read(self, count): self.reads += 1; return b"bad"
            response = Response()
            fetcher = subject.QuotaRangeFetcher({"one.zip": {"bytes": 10, "url": "https://zenodo.org/test"}}, quota,
                                               lambda *args, **kwargs: response)
            with patch.object(quota.stop, "wait", return_value=False):
                with self.assertRaises(ValueError): fetcher.fetch("one.zip", 0, 9)
            self.assertEqual(response.reads, 0)
            self.assertEqual(quota.snapshot()["parallelChargeBytes"], 0)

    def test_complete_real_zip_members_with_four_workers_and_verified_resume(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output, blobs = self.study(folder)
            opener = FakeOpener(blobs)
            plan_hash = subject.base.digest_file(output/"plan.json")
            result = subject.download_parallel(root, output, 4, 0, opener)
            self.assertTrue(result["complete"])
            self.assertEqual(len(result["clips"]), 60)
            self.assertGreaterEqual(opener.maximum, 2)
            self.assertLessEqual(opener.maximum, 4)
            self.assertEqual(subject.base.digest_file(output/"plan.json"), plan_hash)
            final = json.loads((output/"manifest.json").read_text())
            self.assertEqual(final["frozenPlanSha256"], plan_hash)
            self.assertEqual(len(final["clips"]), 60)
            self.assertTrue(all(Path(row["localFile"]).name == row["localFile"] for row in final["clips"]))
            self.assertTrue(all(row["crc32Verified"] and row["savedHashVerified"] for row in final["clips"]))
            self.assertFalse(any(row["archiveFullMd5Verified"] for row in final["clips"]))
            self.assertLessEqual(final["acquisition"]["confirmedAppLevelResponseBodyBytes"], final["acquisition"]["conservativelyAccountedPayloadBytes"])
            self.assertLessEqual(final["acquisition"]["conservativelyAccountedPayloadBytes"], subject.base.MAX_NETWORK_BYTES)
            calls = opener.calls
            subject.download_parallel(root, output, 4, None, opener)
            self.assertEqual(opener.calls, calls)

    def test_checksum_verified_orphan_recovered_without_redownload(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output, blobs = self.study(folder)
            plan = json.loads((output/"plan.json").read_text())
            row = plan["clips"][0]
            (output/row["local_file"]).write_bytes(row["clip_id"].encode()*10)
            opener = FakeOpener(blobs)
            result = subject.download_parallel(root, output, 4, 0, opener)
            self.assertTrue(result["complete"])
            self.assertEqual(opener.calls, 59)

    def test_bad_existing_video_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output, blobs = self.study(folder)
            plan = json.loads((output/"plan.json").read_text())
            row = plan["clips"][0]
            path = output/row["local_file"]
            path.write_bytes(b"tampered")
            with self.assertRaises(ValueError): subject.download_parallel(root, output, 4, 0, FakeOpener(blobs))
            self.assertEqual(path.read_bytes(), b"tampered")
            self.assertFalse((output/"manifest.json").exists())

    def test_base_source_or_plan_changes_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output, blobs = self.study(folder)
            opener = FakeOpener(blobs)
            with patch.object(subject, "EXPECTED_BASE_SHA256", "0"*64):
                with self.assertRaisesRegex(ValueError, "Frozen base downloader source hash changed"):
                    subject.download_parallel(root, output, 4, 0, opener)
            (output/"plan.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "Frozen plan hash changed"):
                subject.download_parallel(root, output, 4, 0, opener)
            self.assertEqual(opener.calls, 0)

    def test_mode_change_and_bad_resume_video_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output, blobs = self.study(folder)
            subject.download_parallel(root, output, 4, 0, FakeOpener(blobs))
            with self.assertRaisesRegex(ValueError, "Frozen acquisition mode"):
                subject.download_parallel(root, output, 3, None, FakeOpener(blobs))
            plan = json.loads((output/"plan.json").read_text())
            path = output/plan["clips"][0]["local_file"]
            data = bytearray(path.read_bytes()); data[0] ^= 1; path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, "source member CRC32"):
                subject.download_parallel(root, output, 4, None, FakeOpener(blobs))

    def test_outside_workspace_and_worker_bounds(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)/".training-data"
            with self.assertRaises(ValueError): subject.download_parallel(root, Path(folder)/"public", 4, 0)
            (root/"study").mkdir(parents=True)
            with self.assertRaises(ValueError): subject.download_parallel(root, root/"study", 5, 0)

    def test_overlapping_output_runs_rejected_and_lock_reusable_after_release(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output, _ = self.study(folder)
            lock_path = output/"parallel-acquisition.lock"
            with subject.ExclusiveOutputRun(lock_path):
                with self.assertRaisesRegex(RuntimeError, "Another acquisition"):
                    subject.download_parallel(root, output, 4, 0)
                script = ("from training.download_tasks_parallel import ExclusiveOutputRun; import sys; "
                          "p=sys.argv[1]\ntry:\n with ExclusiveOutputRun(p): pass\nexcept RuntimeError:\n sys.exit(0)\nsys.exit(1)")
                result = subprocess.run([sys.executable, "-B", "-c", script, str(lock_path)],
                                        cwd=Path(subject.__file__).resolve().parent.parent, capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertTrue(lock_path.is_file())
            with subject.ExclusiveOutputRun(lock_path):
                pass

    def test_racing_destination_is_not_replaced_during_atomic_install(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output, blobs = self.study(folder)
            plan = json.loads((output/"plan.json").read_text())
            row = plan["clips"][0]
            quota = subject.DurableQuota(output/"test-race-quota.json", {"study": "race"}, 0)
            destination = output/row["local_file"]
            real_link = subject.os.link
            def rival_created(source, target):
                Path(target).write_bytes(b"rival-file-must-survive")
                return real_link(source, target)
            with patch.object(subject.os, "link", side_effect=rival_created):
                with self.assertRaisesRegex(ValueError, "Refusing to overwrite"):
                    subject.acquire_member(output, row, plan["archives"], quota, FakeOpener(blobs))
            self.assertEqual(destination.read_bytes(), b"rival-file-must-survive")
            self.assertFalse(destination.with_suffix(destination.suffix+".parallel.part").exists())


if __name__ == "__main__":
    unittest.main()
