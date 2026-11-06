"""Bounded four-worker acquisition for an already frozen Tasks-video study.

No selection, extraction, predictions or fitting. The immutable base downloader
supplies exact member validation/decoding; this wrapper adds durable global
response-body quota reservations and coordinator-owned download progress.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import threading
import urllib.request
import zlib

if os.name == "nt":
    import msvcrt
else:
    import fcntl

try:
    from . import fetch_tasks_study as base
except ImportError:
    import fetch_tasks_study as base

EXPECTED_BASE_SHA256 = "f33bf0a2dc800c567fd4e441a1d841e1e356ca9ecb472b23345c2cc4e6e3f15e"
MAX_WORKERS = 4
READ_BLOCK_BYTES = 65536


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf8", newline="\n") as destination:
        destination.write(base.stable_json(value))
        destination.flush()
        os.fsync(destination.fileno())
    os.replace(temporary, path)


class AcquisitionCancelled(ValueError):
    pass


class ExclusiveOutputRun:
    """OS-held lock: overlapping CLI runs fail; process exit releases it.

    Keep the small lock file in place after release. Unlinking an active lock
    could let another process lock a different inode at the same pathname.
    """
    def __init__(self, path):
        self.path, self.handle = Path(path), None

    def __enter__(self):
        self.handle = self.path.open("a+b")
        if self.path.stat().st_size == 0:
            self.handle.write(b"\0")
            self.handle.flush()
            os.fsync(self.handle.fileno())
        self.handle.seek(0)
        try:
            if os.name == "nt":
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.handle.close()
            self.handle = None
            raise RuntimeError("Another acquisition already holds this output lock") from error
        return self

    def __exit__(self, *args):
        try:
            self.handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()


class DurableQuota:
    """Charge before reads, then commit actual received bytes after reads.

    Interrupted/exceptional reads retain their full charge. The ledger therefore
    remains an upper bound after process interruption; confirmed bytes are a
    separately reported lower bound, never presented as wire-byte accounting.
    """
    def __init__(self, path, identity, initial_bytes, limit=base.MAX_NETWORK_BYTES):
        self.path, self.lock, self.stop = Path(path), threading.RLock(), threading.Event()
        self.identity, self.limit = identity, limit
        if type(initial_bytes) is not int or not 0 <= initial_bytes <= limit:
            raise base.BudgetExceeded("Invalid initial acquisition quota charge")
        if self.path.exists():
            self.state = json.loads(self.path.read_text(encoding="utf8"))
            if self.state.get("identity") != identity or self.state.get("initialChargeBytes") != initial_bytes or self.state.get("limitBytes") != limit:
                raise ValueError("Quota ledger belongs to a different acquisition")
        else:
            self.state = {"format": "signbridge-durable-body-quota-v1", "identity": identity,
                          "initialChargeBytes": initial_bytes, "limitBytes": limit,
                          "parallelChargeBytes": 0, "parallelConfirmedBytes": 0, "readReservations": 0}
            atomic_json(self.path, self.state)
        charged, confirmed = self.state.get("parallelChargeBytes"), self.state.get("parallelConfirmedBytes")
        if (type(charged) is not int or type(confirmed) is not int or not 0 <= confirmed <= charged
                or initial_bytes + charged > limit):
            raise base.BudgetExceeded("Invalid or over-budget persisted quota ledger")

    def reserve(self, requested):
        with self.lock:
            if self.stop.is_set():
                raise AcquisitionCancelled("Acquisition was cancelled")
            if type(requested) is not int or not 1 <= requested <= READ_BLOCK_BYTES:
                raise ValueError("Invalid bounded read reservation")
            remaining = self.limit - self.state["initialChargeBytes"] - self.state["parallelChargeBytes"]
            if remaining <= 0:
                raise base.BudgetExceeded("Global response-body quota exhausted")
            count = min(requested, remaining)
            self.state["parallelChargeBytes"] += count
            self.state["readReservations"] += 1
            atomic_json(self.path, self.state)
            return count

    def commit(self, reservation, actual):
        if not 0 <= actual <= reservation:
            raise ValueError("Response read exceeded its durable reservation")
        with self.lock:
            self.state["parallelChargeBytes"] -= reservation - actual
            self.state["parallelConfirmedBytes"] += actual
            atomic_json(self.path, self.state)

    def snapshot(self):
        with self.lock:
            return dict(self.state)


class QuotaRangeFetcher:
    def __init__(self, archives, quota, opener=None):
        self.archives, self.quota = archives, quota
        self.opener = opener or urllib.request.urlopen
        self.bytes_downloaded = 0

    def fetch(self, name, start, end):
        source = self.archives.get(name)
        if (not source or type(start) is not int or type(end) is not int or start < 0 or end < start
                or end >= source["bytes"] or end-start+1 > base.MAX_MEMBER_BYTES):
            raise ValueError("Invalid bounded allowlisted archive range")
        expected = end-start+1
        for attempt in range(3):
            try:
                if self.quota.stop.is_set():
                    raise AcquisitionCancelled("Acquisition was cancelled")
                request = urllib.request.Request(source["url"], headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"})
                with self.opener(request, timeout=40) as response:
                    if (response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{source['bytes']}"
                            or response.headers.get("Content-Encoding", "identity") != "identity"
                            or response.headers.get("Content-Length", str(expected)) != str(expected)):
                        raise ValueError("Server ignored exact bounded range headers")
                    blocks, length = [], 0
                    while length < expected:
                        reservation = self.quota.reserve(min(READ_BLOCK_BYTES, expected-length))
                        # If read raises or the process stops here, the persisted
                        # reservation remains charged, covering any partial read.
                        block = response.read(reservation)
                        self.quota.commit(reservation, len(block))
                        self.bytes_downloaded += len(block)
                        if not block:
                            break
                        blocks.append(block)
                        length += len(block)
                    if length != expected:
                        raise ValueError("Range body length differs from request")
                return b"".join(blocks)
            except (base.BudgetExceeded, AcquisitionCancelled):
                raise
            except (OSError, ValueError):
                if attempt == 2:
                    raise
                if self.quota.stop.wait(attempt+1):
                    raise AcquisitionCancelled("Acquisition was cancelled")


def load_verified_plan(data_root, output):
    root, output = base.checked_output(data_root, output)
    actual_base = base.digest_file(Path(base.__file__))
    if actual_base != EXPECTED_BASE_SHA256:
        raise ValueError("Frozen base downloader source hash changed")
    plan_path = output/"plan.json"
    plan_hash = base.digest_file(plan_path)
    if (output/"plan.sha256").read_text(encoding="ascii").strip() != plan_hash:
        raise ValueError("Frozen plan hash changed")
    plan = json.loads(plan_path.read_text(encoding="utf8"))
    selected, provenance = base.select_study(root)
    if (plan.get("format") != "signbridge-tasks-video-study-v1" or plan.get("selection_provenance") != provenance
            or len(plan.get("clips", [])) != len(selected)):
        raise ValueError("Frozen selection provenance changed")
    source_path = output/"source-record.json"
    if base.digest_file(source_path) != plan["source_record_sha256"] or plan["source_record"] != base.RECORD_API:
        raise ValueError("Frozen official source record changed")
    archives = base.archives_from_record(json.loads(source_path.read_text(encoding="utf8")), {row["category"] for row in selected})
    if plan["archives"] != archives or len(selected) > base.MAX_CLIPS:
        raise ValueError("Frozen official archive allowlist changed")
    for row, original in zip(plan["clips"], selected):
        if (any(row[key] != value for key, value in original.items()) or row["archive"] not in archives
                or row["name"] != original["clip_id"] or Path(row["local_file"]).name != row["local_file"]
                or any(type(row[key]) is not int or not 1 <= row[key] <= base.MAX_MEMBER_BYTES
                       for key in ("compressed_bytes", "uncompressed_bytes"))):
            raise ValueError("Frozen member identity, split, or byte limits changed")
    if any(sum(row[key] for row in plan["clips"]) > base.MAX_SELECTED_BYTES for key in ("compressed_bytes", "uncompressed_bytes")):
        raise base.BudgetExceeded("Frozen selected video payload exceeds 900MiB")
    return root, output, plan, plan_hash, actual_base


def verify_saved(output, row, previous=None):
    path = output/row["local_file"]
    if not path.is_file() or path.stat().st_size != row["uncompressed_bytes"]:
        raise ValueError("Saved video size or identity changed")
    crc = 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024*1024), b""):
            crc = zlib.crc32(block, crc)
    if crc & 0xFFFFFFFF != row["crc32"]:
        raise ValueError("Saved video no longer matches source member CRC32")
    digest = base.digest_file(path)
    result = {"local_file": row["local_file"], "sha256": digest, "bytes": row["uncompressed_bytes"],
              "crc32_verified": True, "saved_hash_verified": True}
    if previous is not None and any(previous.get(key) != value for key, value in result.items()):
        raise ValueError("Previously saved video hash or verification changed")
    return result


def acquire_member(output, row, archives, quota, opener=None):
    destination = output/row["local_file"]
    if destination.exists():
        # An interrupted coordinator can leave a fully written orphan. Recover
        # only after independent source CRC, size and read-back SHA verification.
        return verify_saved(output, row)
    temporary = destination.with_suffix(destination.suffix+".parallel.part")
    try:
        data = base.fetch_study_member(QuotaRangeFetcher(archives, quota, opener), row["archive"], row)
        with temporary.open("wb") as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        if temporary.stat().st_size != row["uncompressed_bytes"] or base.digest_file(temporary) != hashlib.sha256(data).hexdigest():
            raise ValueError("Saved selected member differs from decoded bytes")
        # An atomic hard link fails if destination exists; unlike a preceding
        # exists check plus replace, this cannot overwrite a racing creator.
        try:
            os.link(temporary, destination)
        except FileExistsError as error:
            raise ValueError("Refusing to overwrite an existing selected video") from error
        return verify_saved(output, row)
    finally:
        temporary.unlink(missing_ok=True)


def final_manifest(plan, plan_hash, progress, mode, quota):
    state = quota.snapshot()
    confirmed = plan["budgets"]["metadata_payload_received_bytes"] + mode["serialAccountedPayloadBytes"] + state["parallelConfirmedBytes"]
    accounted = state["initialChargeBytes"] + state["parallelChargeBytes"]
    final = {"format": "signbridge-tasks-video-study-manifest-v1", "frozenPlanSha256": plan_hash,
             "sourceRecord": plan["source_record"], "sourceRecordSha256": plan["source_record_sha256"],
             "license": plan["license"], "attribution": plan["attribution"], "counts": plan["counts"],
             "selectionProvenance": plan["selection_provenance"], "limitations": plan["limitations"],
             "acquisition": {"mode": mode, "confirmedAppLevelResponseBodyBytes": confirmed,
                             "conservativelyAccountedPayloadBytes": accounted,
                             "unconfirmedReservedPayloadBytes": accounted-confirmed,
                             "networkPayloadLimitBytes": base.MAX_NETWORK_BYTES,
                             "scope": "HTTP response bodies only; headers/transport wire bytes are not measured."}, "clips": []}
    for row in plan["clips"]:
        saved, archive = progress["clips"][row["clip_id"]], plan["archives"][row["archive"]]
        final["clips"].append({"clipId": row["clip_id"], "label": row["label"], "rawLabel": row["raw_label"], "split": row["split"],
                               "sha256": saved["sha256"], "localFile": row["local_file"], "bytes": saved["bytes"],
                               "crc32": row["crc32"], "crc32Verified": True, "savedHashVerified": True,
                               "officialPartitionFamily": row["official_partition_family"], "officialSourceSplit": row["official_source_split"],
                               "archive": row["archive"], "archiveUrl": archive["url"], "archiveExpectedMd5": archive["md5"],
                               "archiveFullMd5Verified": False})
    return final


def download_parallel(data_root, output, workers=MAX_WORKERS, serial_interruption_reserve=None, opener=None):
    _, output = base.checked_output(data_root, output)
    with ExclusiveOutputRun(output/"parallel-acquisition.lock"):
        return _download_parallel_locked(data_root, output, workers, serial_interruption_reserve, opener)


def _download_parallel_locked(data_root, output, workers, serial_interruption_reserve, opener):
    if type(workers) is not int or not 1 <= workers <= MAX_WORKERS:
        raise ValueError("Worker count must be 1..4")
    _, output, plan, plan_hash, base_hash = load_verified_plan(data_root, output)
    wrapper_hash = base.digest_file(Path(__file__))
    progress_path, mode_path = output/"downloads.json", output/"acquisition-mode.json"
    progress = {"format": "signbridge-tasks-video-downloads-v1", "plan_sha256": plan_hash,
                "clips": {}, "video_range_payload_received_bytes": 0, "complete": False}
    if progress_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf8"))
    if (progress.get("plan_sha256") != plan_hash or type(progress.get("video_range_payload_received_bytes")) is not int
            or progress["video_range_payload_received_bytes"] < 0 or not isinstance(progress.get("clips"), dict)
            or not set(progress["clips"]) <= {row["clip_id"] for row in plan["clips"]}):
        raise ValueError("Invalid prior acquisition progress")
    for row in plan["clips"]:
        if row["clip_id"] in progress["clips"]:
            verify_saved(output, row, progress["clips"][row["clip_id"]])
    if mode_path.exists():
        mode = json.loads(mode_path.read_text(encoding="utf8"))
        if (mode.get("planSha256") != plan_hash or mode.get("baseSha256") != base_hash or mode.get("wrapperSha256") != wrapper_hash
                or mode.get("workers") != workers or serial_interruption_reserve not in (None, mode.get("serialInterruptionReserveBytes"))):
            raise ValueError("Frozen acquisition mode or source implementation changed")
    else:
        if serial_interruption_reserve is None or type(serial_interruption_reserve) is not int or serial_interruption_reserve < 0:
            raise ValueError("First parallel run requires an explicit conservative serial interruption reserve")
        mode = {"format": "signbridge-tasks-acquisition-mode-v1", "planSha256": plan_hash, "baseSha256": base_hash,
                "wrapperSha256": wrapper_hash, "workers": workers,
                "serialAccountedPayloadBytes": progress["video_range_payload_received_bytes"],
                "serialInterruptionReserveBytes": serial_interruption_reserve,
                "quotaPolicy": "Atomic/fsync global reservation before every response.read of at most 65536 bytes; successful reads commit actual bytes; failed/interrupted reads stay fully charged. Resume only with this pinned wrapper.",
                "selectionUnchanged": True}
        atomic_json(mode_path, mode)
    initial_charge = plan["budgets"]["metadata_payload_received_bytes"] + mode["serialAccountedPayloadBytes"] + mode["serialInterruptionReserveBytes"]
    quota = DurableQuota(output/"parallel-network-quota.json", {"planSha256": plan_hash, "baseSha256": base_hash, "wrapperSha256": wrapper_hash}, initial_charge)
    def save_progress():
        state = quota.snapshot()
        progress["video_range_payload_received_bytes"] = mode["serialAccountedPayloadBytes"] + state["parallelConfirmedBytes"]
        progress["conservatively_accounted_network_payload_bytes"] = initial_charge + state["parallelChargeBytes"]
        atomic_json(progress_path, progress)
    pending = [row for row in plan["clips"] if row["clip_id"] not in progress["clips"]]
    save_progress()
    executor = ThreadPoolExecutor(max_workers=workers)
    futures = {}
    try:
        futures = {executor.submit(acquire_member, output, row, plan["archives"], quota, opener): row for row in pending}
        for future in as_completed(futures):
            row = futures[future]
            progress["clips"][row["clip_id"]] = future.result()
            save_progress()
            print(json.dumps({"clipId": row["clip_id"], "split": row["split"], "verified": len(progress["clips"]),
                              "selected": len(plan["clips"]), "confirmedVideoResponseBodyBytes": progress["video_range_payload_received_bytes"],
                              "conservativeTotalPayloadBytes": progress["conservatively_accounted_network_payload_bytes"]}), flush=True)
    except BaseException:
        quota.stop.set()
        for future in futures:
            future.cancel()
        raise
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
        save_progress()
    if len(progress["clips"]) != len(plan["clips"]):
        raise ValueError("Incomplete selected study acquisition")
    for row in plan["clips"]:
        verify_saved(output, row, progress["clips"][row["clip_id"]])
    progress["complete"] = True
    save_progress()
    final = final_manifest(plan, plan_hash, progress, mode, quota)
    final_path = output/"manifest.json"
    if final_path.exists() and json.loads(final_path.read_text(encoding="utf8")) != final:
        raise ValueError("Refusing to replace a different completed manifest")
    atomic_json(final_path, final)
    return progress


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=Path(".training-data"))
    parser.add_argument("--output", type=Path, default=Path(".training-data/tasks-video-study-2026-10-13"))
    parser.add_argument("--workers", type=int, default=MAX_WORKERS)
    parser.add_argument("--serial-interruption-reserve", type=int)
    args = parser.parse_args()
    result = download_parallel(args.data_root, args.output, args.workers, args.serial_interruption_reserve)
    print(json.dumps({"complete": result["complete"], "verifiedClips": len(result["clips"]),
                      "confirmedVideoResponseBodyBytes": result["video_range_payload_received_bytes"],
                      "conservativeTotalPayloadBytes": result["conservatively_accounted_network_payload_bytes"]}), flush=True)


if __name__ == "__main__":
    main()
