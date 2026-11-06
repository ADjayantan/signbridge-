"""Freeze a small official INCLUDE video study, then fetch only selected ZIP ranges.

Planning reads CSV/clip identities and ZIP directories, never model predictions or
pose features. Downloading is a separate phase. This script does not fit a model.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import re
import struct
import time
import urllib.request

import numpy as np

try:
    from .fetch_include_reference import digest_file, parse_directory, decode_member
except ImportError:
    from fetch_include_reference import digest_file, parse_directory, decode_member

RECORD_API = "https://zenodo.org/api/records/4010759"
MAX_RECORD_BYTES = 2 * 1024 * 1024
MAX_DIRECTORY_BYTES = 2 * 1024 * 1024
MAX_MEMBER_BYTES = 45 * 1024 * 1024
MAX_SELECTED_BYTES = 900 * 1024 * 1024
MAX_NETWORK_BYTES = 1024 * 1024 * 1024
MAX_CLIPS = 100
# 13 October pre-fit acquisition addendum: the original 66-clip selection
# exceeded both 900 MiB payload caps. Retain first SIX identities, without
# inspecting predictions, for these three training words; all holdouts stay.
FOCUS = (("48. Hello", "HELLO", 6), ("55. Thank you", "THANK YOU", 6),
         ("51. Good Morning", "GOOD MORNING", 6), ("61. Father", "FATHER", 4))
UNSUPPORTED_GREETINGS = ("49. How are you", "50. Alright", "52. Good afternoon",
                         "53. Good evening", "54. Good night", "56. Pleased")
PARTITIONS = ("train", "val", "test", "unknown_validation", "unknown_test")
LEGACY_REFERENCES = {"Greetings/48. Hello/MVI_9917.MOV", "Greetings/55. Thank you/MVI_0008.MOV"}


class BudgetExceeded(ValueError):
    pass


def stable_json(value):
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def checked_output(data_root, output):
    root, output = Path(data_root).resolve(), Path(output).resolve()
    if root.name != ".training-data" or root not in output.parents:
        raise ValueError("Output must stay in a child of ignored .training-data")
    return root, output


def read_csv(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def select_study(data_root):
    """No feature arrays, scores or model files are read to choose recordings."""
    root = Path(data_root)
    train_csv, test_csv = root / "metadata/train_include.csv", root / "metadata/test_include.csv"
    official = {"train": read_csv(train_csv), "test": read_csv(test_csv)}
    known_official = {split: read_csv(root / f"metadata/{split}_include50.csv") for split in ("train", "test")}
    official_ids = {split: {row["FilePath"] for row in rows} for split, rows in official.items()}
    known_official_ids = {split: {row["FilePath"] for row in rows} for split, rows in known_official.items()}
    if official_ids["train"] & official_ids["test"]:
        raise ValueError("Official recording partitions overlap")
    if any(len(official_ids[split]) != len(rows) for split, rows in official.items()):
        raise ValueError("Official CSV has duplicate clip identities")
    row_map = {row["FilePath"]: row for rows in [*official.values(), *known_official.values()] for row in rows}
    prepared = root / "prepared/isl.npz"
    with np.load(prepared, allow_pickle=False) as archive:
        known_labels = archive["raw_labels"].tolist()
        model_labels = archive["labels"].tolist()
        partitions = {split: set(archive[f"clip_ids_{split}"].tolist()) for split in PARTITIONS}
    for index, left in enumerate(PARTITIONS):
        for right in PARTITIONS[index + 1:]:
            if partitions[left] & partitions[right]:
                raise ValueError("Existing prepared partitions overlap")
    if not (partitions["train"] | partitions["val"]) <= known_official_ids["train"] or not partitions["test"] <= known_official_ids["test"]:
        raise ValueError("Existing known split identities disagree with official CSV")
    prior_path = root / "camera-study-references-2026-10-11/manifest.json"
    prior = json.loads(prior_path.read_text(encoding="utf8"))
    excluded = LEGACY_REFERENCES | {row["clip_id"] for row in prior["clips"]}
    all_reserved = set.union(*partitions.values()) | excluded
    selected = []

    def append(clip, label, split, source_split, role, family="INCLUDE50"):
        source_ids = known_official_ids if family == "INCLUDE50" else official_ids
        if clip not in source_ids[source_split] or clip in excluded or clip not in row_map:
            raise ValueError("Selected identity has an invalid official split")
        # Names are opaque CSV identities, not arbitrary extraction destinations.
        pieces = clip.split("/")
        if len(pieces) < 3 or any(piece in ("", ".", "..") for piece in pieces) or "\\" in clip or not pieces[-1].lower().endswith((".mov", ".mp4")):
            raise ValueError("Unsafe official clip identity")
        selected.append({"clip_id": clip, "raw_label": row_map[clip]["Word"], "label": label,
                         "split": split, "official_source_split": source_split, "official_partition_family": family, "role": role,
                         "category": pieces[0]})

    for raw_label, label, count in FOCUS:
        if raw_label not in known_labels:
            raise ValueError(f"Current ISL model does not include {label}")
        for split, maximum in (("train", count), ("val", 2), ("test", 2)):
            candidates = sorted(clip for clip in partitions[split] - excluded if row_map[clip]["Word"] == raw_label)
            if not candidates:
                raise ValueError(f"No fresh {label} {split} recording")
            for clip in candidates[:maximum]:
                append(clip, label, split, "test" if split == "test" else "train", "fit" if split == "train" else "held-out; never fit")
    words = sorted(UNSUPPORTED_GREETINGS)
    if set(words) & set(known_labels):
        raise ValueError("Requested unknown word is already a known label")
    # Unknown WORDS, as well as recording IDs, are disjoint across fresh roles.
    unknown_roles = [(word, "unknown_train", "train", 4) for word in words[:3]]
    unknown_roles += [(words[3], "unknown_val", "train", 6)]
    unknown_roles += [(word, "unknown_test", "test", 3) for word in words[4:]]
    for word, split, source_split, required in unknown_roles:
        candidates = sorted(row["FilePath"] for row in official[source_split] if row["Word"] == word and row["FilePath"] not in all_reserved)
        if len(candidates) < required:
            raise ValueError(f"Insufficient fresh {word} {split} recordings: {len(candidates)} < {required}")
        for clip in candidates[:required]:
            append(clip, row_map[clip]["Word"].split(". ", 1)[-1].upper(), split, source_split, "unknown fitting examples" if split == "unknown_train" else "unknown held-out; never fit", "INCLUDE")
    if len(selected) > MAX_CLIPS or len({row["clip_id"] for row in selected}) != len(selected):
        raise ValueError("Duplicate recordings or too many selected clips")
    for index, row in enumerate(selected):
        row["local_file"] = f"{index:03d}-{row['split']}-{hashlib.sha256(row['clip_id'].encode()).hexdigest()[:16]}{Path(row['clip_id']).suffix}"
    provenance = {"official_train_csv_sha256": digest_file(train_csv), "official_test_csv_sha256": digest_file(test_csv),
                  "official_train_include50_csv_sha256": digest_file(root / "metadata/train_include50.csv"), "official_test_include50_csv_sha256": digest_file(root / "metadata/test_include50.csv"),
                  "prepared_identity_archive_sha256": digest_file(prepared), "prior_replay_manifest_sha256": digest_file(prior_path),
                  "excluded_clip_ids": sorted(excluded), "model_labels_retained": model_labels,
                  "selection_rule": "13 October pre-fit budget addendum. Known words: lexicographic existing split IDs, maximum 6/6/6/4 train and 2 val/test each. Unsupported Greetings sorted by official word: first 3 words 4 train each, fourth word 6 val, last 2 words 3 official-test each. Unknown IDs exclude every prior prepared partition. No features or predictions inspected.",
                  "unknown_word_assignment": {"train": words[:3], "val": words[3:4], "test": words[4:]}}
    provenance["known_selection_counts"] = [
        {"label": label, "split": split, "maximum": maximum,
         "selected": sum(row["label"] == label and row["split"] == split for row in selected),
         "shortfall": maximum - sum(row["label"] == label and row["split"] == split for row in selected)}
        for _, label, count in FOCUS for split, maximum in (("train", count), ("val", 2), ("test", 2))
    ]
    return selected, provenance


class RangeFetcher:
    def __init__(self, archives, opener=None, max_bytes=MAX_NETWORK_BYTES):
        self.archives, self.opener = archives, opener or urllib.request.urlopen
        self.bytes_downloaded, self.max_bytes = 0, max_bytes

    def fetch(self, name, start, end):
        source = self.archives.get(name)
        if not source or type(start) is not int or type(end) is not int or start < 0 or end < start or end >= source["bytes"] or end - start + 1 > MAX_MEMBER_BYTES:
            raise ValueError("Invalid bounded allowlisted range")
        expected = end - start + 1
        for attempt in range(3):
            try:
                request = urllib.request.Request(source["url"], headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"})
                with self.opener(request, timeout=40) as response:
                    if response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{source['bytes']}" or response.headers.get("Content-Encoding", "identity") != "identity":
                        raise ValueError("Server ignored exact Content-Range or encoding")
                    blocks, length = [], 0
                    content_length = response.headers.get("Content-Length")
                    if content_length is not None and content_length != str(expected):
                        raise ValueError("Range Content-Length differs from request")
                    while length < expected:
                        remaining = self.max_bytes - self.bytes_downloaded
                        if remaining <= 0:
                            raise BudgetExceeded("Actual received payload reached network budget")
                        block = response.read(min(65536, expected - length, remaining))
                        if not block:
                            break
                        self.bytes_downloaded += len(block)
                        blocks.append(block)
                        length += len(block)
                    if length != expected:
                        raise ValueError("Range response length differs from request")
                return b"".join(blocks)
            except BudgetExceeded:
                raise
            except (OSError, ValueError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)


def read_index(fetcher, name):
    size = fetcher.archives[name]["bytes"]
    start = max(0, size - 65557)
    tail = fetcher.fetch(name, start, size - 1)
    position = tail.rfind(b"PK\x05\x06")
    if position < 0 or position + 22 > len(tail):
        raise ValueError("Archive has no bounded ZIP directory")
    fields = struct.unpack_from("<4s4H2IH", tail, position)
    disk, cd_disk, disk_entries, entries, cd_size, cd_offset, comment_size = fields[1:]
    if disk or cd_disk or disk_entries != entries or entries == 0xFFFF or cd_size < 1 or cd_size > MAX_DIRECTORY_BYTES or cd_offset + cd_size > start + position or position + 22 + comment_size != len(tail):
        raise ValueError("Unsupported or malformed ZIP directory")
    directory = tail[cd_offset-start:cd_offset-start+cd_size] if cd_offset >= start else fetcher.fetch(name, cd_offset, cd_offset+cd_size-1)
    rows = parse_directory(directory)
    if len(rows) != entries:
        raise ValueError("ZIP directory count mismatch")
    return rows


def validate_member_header(header, row):
    if len(header) != 30:
        raise ValueError("Truncated selected ZIP local header")
    fields = struct.unpack("<4s5H3I2H", header)
    if fields[0] != b"PK\x03\x04" or fields[2] != row["flags"] or fields[3] != row["method"]:
        raise ValueError("Local/central ZIP header mismatch")
    expected_name = row["name"].encode("utf-8" if row["flags"] & 0x800 else "cp437")
    name_size, extra_size = fields[-2:]
    if name_size != len(expected_name) or name_size < 1:
        raise ValueError("Selected local ZIP name length differs from identity")
    for actual, key in zip(fields[6:9], ("crc32", "compressed_bytes", "uncompressed_bytes")):
        # Bit3 indicates a following data descriptor; local numeric fields may
        # then be zero. Any supplied nonzero value still must match the index.
        allowed = (0, row[key]) if row["flags"] & 8 else (row[key],)
        if actual not in allowed:
            raise ValueError("Local/central ZIP CRC or size mismatch")
    return expected_name, name_size, extra_size


def fetch_study_member(fetcher, archive_name, row):
    """Read one bounded local span; decode only the selected member bytes.

    At most 65535 bytes of local extra field are possible. A span can include
    that much neighbouring tail; it is never decoded or used as another clip.
    Near the 45MiB range cap, use three exact validated ranges instead.
    """
    archive = fetcher.archives[archive_name]
    offset = row["local_offset"]
    if type(offset) is not int or offset < 0 or offset + 30 > archive["bytes"]:
        raise ValueError("Selected ZIP offset is outside official archive")
    if any(type(row[key]) is not int or not 1 <= row[key] <= MAX_MEMBER_BYTES
           for key in ("compressed_bytes", "uncompressed_bytes")):
        raise ValueError("Selected member exceeds byte bounds")
    expected_name = row["name"].encode("utf-8" if row["flags"] & 0x800 else "cp437")
    maximum_span = 30 + len(expected_name) + 65535 + row["compressed_bytes"]
    if maximum_span <= MAX_MEMBER_BYTES:
        end = min(archive["bytes"] - 1, offset + maximum_span - 1)
        span = fetcher.fetch(archive_name, offset, end)
        expected_name, name_size, extra_size = validate_member_header(span[:30], row)
        data_start = 30 + name_size + extra_size
        data_end = data_start + row["compressed_bytes"]
        if data_end > len(span):
            raise ValueError("Truncated selected ZIP member span")
        if span[30:30+name_size] != expected_name:
            raise ValueError("Selected local ZIP member has another identity")
        compressed = span[data_start:data_end]
    else:
        header = fetcher.fetch(archive_name, offset, offset + 29)
        expected_name, name_size, extra_size = validate_member_header(header, row)
        name_start = offset + 30
        name_stop = name_start + name_size + extra_size
        if name_stop + row["compressed_bytes"] > archive["bytes"]:
            raise ValueError("Selected ZIP member extends outside official archive")
        extra = fetcher.fetch(archive_name, name_start, name_stop - 1)
        if extra[:name_size] != expected_name:
            raise ValueError("Selected local ZIP member has another identity")
        compressed = fetcher.fetch(archive_name, name_stop, name_stop + row["compressed_bytes"] - 1)
    return decode_member(compressed, row)


def fetch_record(opener=None, on_received=None):
    opener = opener or urllib.request.urlopen
    with opener(urllib.request.Request(RECORD_API, headers={"Accept": "application/json", "Accept-Encoding": "identity"}), timeout=40) as response:
        if response.status != 200 or response.headers.get("Content-Encoding", "identity") != "identity":
            raise ValueError("Official Zenodo record is unavailable")
        blocks, received = [], 0
        while received < MAX_RECORD_BYTES + 1:
            block = response.read(min(65536, MAX_RECORD_BYTES + 1 - received))
            if not block:
                break
            blocks.append(block)
            received += len(block)
            if on_received is not None:
                on_received(len(block))
        raw = b"".join(blocks)
    if len(raw) > MAX_RECORD_BYTES:
        raise ValueError("Official source record exceeds bounded JSON size")
    record = json.loads(raw)
    if str(record.get("id")) != "4010759" or record.get("metadata", {}).get("license", {}).get("id") != "cc-by-4.0":
        raise ValueError("Unexpected official source record or license")
    return record, raw


def archives_from_record(record, categories):
    archives = {}
    for source in record["files"]:
        match = re.fullmatch(r"(.+)_(\d+)of(\d+)\.zip", source["key"])
        if not match or match[1] not in categories:
            continue
        name = source["key"]
        # Zenodo's current record API exposes a content URL under `self`;
        # accept either documented metadata shape only at the exact record URL.
        links = source.get("links", {})
        url = links.get("content") or links.get("self")
        expected_url = f"https://zenodo.org/api/records/4010759/files/{name}/content"
        if url != expected_url or not re.fullmatch(r"md5:[0-9a-f]{32}", source.get("checksum", "")) or type(source.get("size")) is not int or source["size"] < 22:
            raise ValueError("Official archive metadata is incomplete or unexpected")
        archives[name] = {"bytes": source["size"], "md5": source["checksum"][4:], "url": url}
    for category in categories:
        matching = [name for name in archives if name.startswith(category + "_")]
        counts = [re.fullmatch(r".+_(\d+)of(\d+)\.zip", name) for name in matching]
        if not counts or len({int(match[2]) for match in counts}) != 1 or {int(match[1]) for match in counts} != set(range(1, int(counts[0][2]) + 1)):
            raise ValueError(f"Incomplete official archive parts for {category}")
    return dict(sorted(archives.items()))


def freeze_plan(data_root, output, record_loader=fetch_record, fetcher_factory=RangeFetcher):
    root, output = checked_output(data_root, output)
    selected, provenance = select_study(root)
    path = output / "plan.json"
    if path.exists():
        pin_path = output / "plan.sha256"
        if not pin_path.is_file() or pin_path.read_text(encoding="ascii").strip() != digest_file(path):
            raise ValueError("Frozen plan hash changed or is missing")
        previous = json.loads(path.read_text(encoding="utf8"))
        if previous.get("selection_provenance") != provenance or [row["clip_id"] for row in previous.get("clips", [])] != [row["clip_id"] for row in selected]:
            raise ValueError("Refusing to replace a different frozen study")
        return previous, path
    # Persist metadata reads even when a directory lookup fails, so another
    # planning attempt cannot reset the acquisition-wide network allowance.
    output.mkdir(parents=True, exist_ok=True)
    planning_path = output / "planning-downloads.json"
    prior_metadata = 0
    if planning_path.exists():
        planning = json.loads(planning_path.read_text(encoding="utf8"))
        prior_metadata = planning["metadata_payload_received_bytes"]
        if type(prior_metadata) is not int or not 0 <= prior_metadata < MAX_NETWORK_BYTES:
            raise BudgetExceeded("Invalid or exhausted planning payload ledger")
    if MAX_NETWORK_BYTES - prior_metadata < MAX_RECORD_BYTES + 1:
        raise BudgetExceeded("Insufficient remaining allowance for bounded source metadata")
    metadata_bytes = prior_metadata
    def count_record_bytes(count):
        nonlocal metadata_bytes
        metadata_bytes += count
        planning_path.write_text(stable_json({"metadata_payload_received_bytes": metadata_bytes}), encoding="utf8")
    if record_loader is fetch_record:
        record, raw = fetch_record(on_received=count_record_bytes)
    else:
        record, raw = record_loader()
        metadata_bytes += len(raw)
    planning_path.write_text(stable_json({"metadata_payload_received_bytes": metadata_bytes}), encoding="utf8")
    (output / "source-record.json").write_bytes(raw)
    archives = archives_from_record(record, {row["category"] for row in selected})
    fetcher = fetcher_factory(archives, max_bytes=MAX_NETWORK_BYTES-metadata_bytes)
    indexes = {}
    cache_root = output / "archive-indexes"
    cache_root.mkdir(exist_ok=True)
    try:
        for name in archives:
            cache_path = cache_root / f"{name}.json"
            cache_pin = cache_root / f"{name}.sha256"
            if cache_path.exists():
                if not cache_pin.is_file() or cache_pin.read_text(encoding="ascii").strip() != digest_file(cache_path):
                    raise ValueError("Cached official ZIP index hash changed")
                cached = json.loads(cache_path.read_text(encoding="utf8"))
                if cached.get("archive") != archives[name] or cached.get("name") != name:
                    raise ValueError("Cached index belongs to different source archive")
                indexes[name] = cached["entries"]
            else:
                print(json.dumps({"phase": "archive-index", "archive": name, "status": "reading"}), flush=True)
                indexes[name] = read_index(fetcher, name)
                cache_path.write_text(stable_json({"name": name, "archive": archives[name], "entries": indexes[name]}), encoding="utf8")
                cache_pin.write_text(digest_file(cache_path) + "\n", encoding="ascii")
            planning_path.write_text(stable_json({"metadata_payload_received_bytes": metadata_bytes + fetcher.bytes_downloaded}), encoding="utf8")
            print(json.dumps({"phase": "archive-index", "archive": name, "status": "ready", "entries": len(indexes[name]),
                              "metadata_payload_received_bytes": metadata_bytes + fetcher.bytes_downloaded}), flush=True)
    finally:
        metadata_bytes += fetcher.bytes_downloaded
        planning_path.write_text(stable_json({"metadata_payload_received_bytes": metadata_bytes}), encoding="utf8")
    for row in selected:
        matches = [(name, entries[row["clip_id"]]) for name, entries in indexes.items() if row["clip_id"] in entries]
        if len(matches) != 1:
            raise ValueError(f"Clip is not present exactly once in source ZIPs: {row['clip_id']}")
        archive, entry = matches[0]
        if any(entry[key] < 1 or entry[key] > MAX_MEMBER_BYTES for key in ("compressed_bytes", "uncompressed_bytes")):
            raise ValueError("Selected clip exceeds 45 MiB member bound")
        row.update(entry)
        row["archive"] = archive
    compressed = sum(row["compressed_bytes"] for row in selected)
    uncompressed = sum(row["uncompressed_bytes"] for row in selected)
    if compressed > MAX_SELECTED_BYTES or uncompressed > MAX_SELECTED_BYTES:
        raise BudgetExceeded(f"Frozen study exceeds 900 MiB: compressed={compressed}, decompressed disk={uncompressed}")
    plan = {"format": "signbridge-tasks-video-study-v1", "source_record": RECORD_API, "source_record_sha256": hashlib.sha256(raw).hexdigest(),
            "license": "CC BY 4.0", "attribution": "Sridhar, Ganesan, Kumar and Khapra. INCLUDE (2020), DOI 10.1145/3394171.3413528",
            "selection_provenance": provenance, "archives": archives, "clips": selected,
            "counts": dict(sorted(Counter(row["split"] for row in selected).items())),
            "budgets": {"clip_limit": MAX_CLIPS, "member_bytes_limit": MAX_MEMBER_BYTES, "compressed_video_bytes": compressed,
                        "decompressed_video_disk_bytes": uncompressed, "compressed_limit": MAX_SELECTED_BYTES, "decompressed_limit": MAX_SELECTED_BYTES,
                        "metadata_payload_received_bytes": metadata_bytes, "actual_total_network_payload_limit": MAX_NETWORK_BYTES},
            "limitations": ["No signer identifiers; no signer-disjoint or webcam accuracy claim.", "Official test and fresh unknown validation/test clips never fit or calibrate.",
                            "All 49 model labels retained; this focused batch is not balanced 49-class training data.", "Partial ZIP ranges verify member CRC32 and saved SHA256, not full archive MD5.",
                            "Unknown train words differ from fresh unknown validation/test words; pre-existing archived holdouts remain untouched."]}
    output.mkdir(parents=True, exist_ok=True)
    (output / "source-record.json").write_bytes(raw)
    path.write_text(stable_json(plan), encoding="utf8")
    (output / "plan.sha256").write_text(digest_file(path) + "\n", encoding="ascii")
    return plan, path


def download_plan(data_root, output, fetcher_factory=RangeFetcher):
    root, output = checked_output(data_root, output)
    path = output / "plan.json"
    pin_path = output / "plan.sha256"
    if not pin_path.is_file() or pin_path.read_text(encoding="ascii").strip() != digest_file(path):
        raise ValueError("Frozen plan hash changed or is missing")
    plan = json.loads(path.read_text(encoding="utf8"))
    selected, provenance = select_study(root)
    if plan.get("format") != "signbridge-tasks-video-study-v1" or plan.get("selection_provenance") != provenance or [row["clip_id"] for row in plan["clips"]] != [row["clip_id"] for row in selected]:
        raise ValueError("Frozen plan no longer matches verified source identities")
    source_path = output / "source-record.json"
    if digest_file(source_path) != plan["source_record_sha256"]:
        raise ValueError("Frozen official source record changed")
    official_archives = archives_from_record(json.loads(source_path.read_text(encoding="utf8")),
                                            {row["category"] for row in selected})
    if plan["archives"] != official_archives or plan["source_record"] != RECORD_API:
        raise ValueError("Frozen archive allowlist differs from official source record")
    if len(plan["clips"]) > MAX_CLIPS or any(sum(row[key] for row in plan["clips"]) > MAX_SELECTED_BYTES for key in ("compressed_bytes", "uncompressed_bytes")):
        raise BudgetExceeded("Frozen plan exceeds byte or clip limits")
    for row, identity in zip(plan["clips"], selected):
        if (any(row[key] != value for key, value in identity.items())
                or row["archive"] not in plan["archives"] or row["name"] != identity["clip_id"]
                or any(type(row[key]) is not int or not 1 <= row[key] <= MAX_MEMBER_BYTES
                       for key in ("compressed_bytes", "uncompressed_bytes"))):
            raise ValueError("Frozen local file identity or archive changed")
    plan_hash = digest_file(path)
    progress_path = output / "downloads.json"
    progress = {"format": "signbridge-tasks-video-downloads-v1", "plan_sha256": plan_hash, "clips": {}, "video_range_payload_received_bytes": 0, "complete": False}
    if progress_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf8"))
        if progress.get("plan_sha256") != plan_hash:
            raise ValueError("Progress belongs to another frozen plan")
        if (type(progress.get("video_range_payload_received_bytes")) is not int
                or progress["video_range_payload_received_bytes"] < 0
                or not isinstance(progress.get("clips"), dict)
                or not set(progress["clips"]) <= {row["clip_id"] for row in plan["clips"]}):
            raise ValueError("Invalid frozen download progress")
    metadata_bytes = plan["budgets"]["metadata_payload_received_bytes"]
    previous_payload = progress["video_range_payload_received_bytes"]
    if previous_payload + metadata_bytes > MAX_NETWORK_BYTES:
        raise BudgetExceeded("Previous received payload exceeds acquisition allowance")
    fetcher = fetcher_factory(plan["archives"], max_bytes=MAX_NETWORK_BYTES-metadata_bytes-previous_payload)
    for row in plan["clips"]:
        destination = output / row["local_file"]
        prior = progress["clips"].get(row["clip_id"])
        if prior:
            if (prior.get("local_file") != row["local_file"] or prior.get("bytes") != row["uncompressed_bytes"]
                    or prior.get("crc32_verified") is not True or prior.get("saved_hash_verified") is not True
                    or not destination.is_file() or destination.stat().st_size != row["uncompressed_bytes"]
                    or digest_file(destination) != prior["sha256"]):
                raise ValueError("Previously saved video hash or size changed")
            continue
        if destination.exists():
            raise ValueError("Refusing to overwrite an unverified existing video")
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            data = fetch_study_member(fetcher, row["archive"], row)
            digest = hashlib.sha256(data).hexdigest()
            temporary.write_bytes(data)
            if temporary.stat().st_size != row["uncompressed_bytes"] or digest_file(temporary) != digest:
                raise ValueError("Saved decompressed video hash or size mismatch")
            temporary.replace(destination)
            progress["clips"][row["clip_id"]] = {"local_file": row["local_file"], "sha256": digest, "bytes": len(data), "crc32_verified": True, "saved_hash_verified": True}
            print(json.dumps({"clip_id": row["clip_id"], "split": row["split"], "sha256": digest, "bytes": len(data)}), flush=True)
        finally:
            temporary.unlink(missing_ok=True)
            progress["video_range_payload_received_bytes"] = previous_payload + fetcher.bytes_downloaded
            progress_path.write_text(stable_json(progress), encoding="utf8")
    progress["complete"] = True
    progress_path.write_text(stable_json(progress), encoding="utf8")
    final = {"format": "signbridge-tasks-video-study-manifest-v1", "frozenPlanSha256": plan_hash,
             "sourceRecord": plan["source_record"], "sourceRecordSha256": plan["source_record_sha256"],
             "license": plan["license"], "attribution": plan["attribution"], "counts": plan["counts"],
             "selectionProvenance": plan["selection_provenance"], "limitations": plan["limitations"], "clips": []}
    for row in plan["clips"]:
        saved = progress["clips"][row["clip_id"]]
        archive = plan["archives"][row["archive"]]
        final["clips"].append({"clipId": row["clip_id"], "label": row["label"], "rawLabel": row["raw_label"], "split": row["split"],
                               "sha256": saved["sha256"], "localFile": row["local_file"],
                               "bytes": saved["bytes"], "crc32": row["crc32"], "crc32Verified": True, "savedHashVerified": True,
                               "officialPartitionFamily": row["official_partition_family"], "officialSourceSplit": row["official_source_split"],
                               "archive": row["archive"], "archiveUrl": archive["url"], "archiveExpectedMd5": archive["md5"], "archiveFullMd5Verified": False})
    final_path = output / "manifest.json"
    if final_path.exists() and json.loads(final_path.read_text(encoding="utf8")) != final:
        raise ValueError("Refusing to overwrite a different completed manifest")
    final_path.write_text(stable_json(final), encoding="utf8")
    return progress


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=Path(".training-data"))
    parser.add_argument("--output", type=Path, default=Path(".training-data/tasks-video-study-2026-10-13"))
    parser.add_argument("--phase", choices=("plan", "download"), default="plan")
    args = parser.parse_args()
    if args.phase == "plan":
        plan, path = freeze_plan(args.data_root, args.output)
        print(json.dumps({"phase": "plan", "plan": str(path), "plan_sha256": digest_file(path), "counts": plan["counts"], "budgets": plan["budgets"]}), flush=True)
    else:
        progress = download_plan(args.data_root, args.output)
        print(json.dumps({"phase": "download", "complete": progress["complete"], "clips": len(progress["clips"]), "plan_sha256": progress["plan_sha256"], "received_payload_bytes": progress["video_range_payload_received_bytes"]}), flush=True)


if __name__ == "__main__":
    main()
