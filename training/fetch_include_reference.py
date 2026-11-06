"""Fetch four frozen INCLUDE references using bounded ZIP byte ranges only.

The two official-test clips are replay-only, never fitting/calibration inputs.
No model prediction is read to choose clips. This does not train a model.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import struct
import time
import urllib.request
import zlib

ARCHIVES = {
    "Greetings_1of2.zip": {"bytes": 1573733886, "md5": "457624ce89b2d32520d6b61bd1f113a2"},
    "Greetings_2of2.zip": {"bytes": 1208700458, "md5": "2dd843662545b0ca57e79cff84562698"},
}
MAX_DIRECTORY_BYTES = 2 * 1024 * 1024
MAX_MEMBER_BYTES = 45 * 1024 * 1024
MAX_TOTAL_MEMBER_BYTES = 180 * 1024 * 1024
SOURCE_RECORD = "https://zenodo.org/records/4010759"


def digest_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def select_references(data_root):
    """Freeze selection using split identity alone; no X arrays or models read."""
    import numpy as np
    root = Path(data_root)
    train_csv = root / "metadata/train_include50.csv"
    test_csv = root / "metadata/test_include50.csv"
    prepared = root / "prepared/isl.npz"
    with train_csv.open(encoding="utf-8-sig", newline="") as source:
        official_train = list(csv.DictReader(source))
    with test_csv.open(encoding="utf-8-sig", newline="") as source:
        official_test = list(csv.DictReader(source))
    with np.load(prepared, allow_pickle=False) as archive:
        # Read prepared identities only. Official CSV class labels identify the
        # requested clips; held-out features and model predictions are not read.
        train_ids = set(archive["clip_ids_train"].tolist())
        val_ids = set(archive["clip_ids_val"].tolist())
        test_ids = set(archive["clip_ids_test"].tolist())
    if train_ids & val_ids or train_ids & test_ids or val_ids & test_ids:
        raise ValueError("Prepared clip identities overlap between splits")
    train_hello = sorted({row["FilePath"] for row in official_train if row["Word"] == "48. Hello" and row["FilePath"] in train_ids})
    test_hello = sorted({row["FilePath"] for row in official_test if row["Word"] == "48. Hello" and row["FilePath"] in test_ids})
    test_thanks = sorted({row["FilePath"] for row in official_test if row["Word"] == "55. Thank you" and row["FilePath"] in test_ids})
    if len(train_hello) < 2 or not test_hello or not test_thanks:
        raise ValueError("Required frozen official split identities are unavailable")
    selections = [
        *({"clip_id": clip, "label": "HELLO", "split": "train", "purpose": "training-source reference audit"} for clip in train_hello[:2]),
        {"clip_id": test_hello[0], "label": "HELLO", "split": "official_test", "purpose": "replay-only; never fit or calibrate"},
        {"clip_id": test_thanks[0], "label": "THANK YOU", "split": "official_test", "purpose": "replay-only; never fit or calibrate"},
    ]
    for row in selections:
        expected = "48. Hello" if row["label"] == "HELLO" else "55. Thank you"
        if not re.fullmatch(r"MVI_\d+_?\.MOV", Path(row["clip_id"]).name) or row["clip_id"] != f"Greetings/{expected}/{Path(row['clip_id']).name}":
            raise ValueError("Unexpected official clip identity")
        row["local_file"] = f"isl-{row['label'].lower().replace(' ', '')}-{row['split']}-{Path(row['clip_id']).name}"
    return selections, {"official_train_csv_sha256": digest_file(train_csv), "official_test_csv_sha256": digest_file(test_csv),
                        "prepared_identity_archive_sha256": digest_file(prepared),
                        "selection": "Lexicographic clip IDs within requested official CSV class labels; two HELLO current train IDs, one HELLO and one THANK YOU official-test ID; no predictions or feature arrays inspected"}


class BoundedFetcher:
    def __init__(self, opener=None):
        self.opener = opener or urllib.request.urlopen
        self.bytes_downloaded = 0

    def fetch(self, name, start, end):
        if name not in ARCHIVES or not isinstance(start, int) or not isinstance(end, int) or start < 0 or end < start or end >= ARCHIVES[name]["bytes"] or end - start + 1 > MAX_MEMBER_BYTES:
            raise ValueError("Invalid bounded archive range")
        url = f"https://zenodo.org/api/records/4010759/files/{name}/content"
        expected_size = end - start + 1
        expected_range = f"bytes {start}-{end}/{ARCHIVES[name]['bytes']}"
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"})
                with self.opener(request, timeout=40) as response:
                    # A server ignoring Range is rejected before reading a GB body.
                    if response.status != 206 or response.headers.get("Content-Range") != expected_range or response.headers.get("Content-Encoding", "identity") != "identity":
                        raise ValueError("Server did not honor the exact bounded byte range")
                    data = response.read(expected_size + 1)
                if len(data) != expected_size:
                    raise ValueError("Archive byte range size mismatch")
                self.bytes_downloaded += len(data)
                return data
            except (OSError, ValueError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)


def parse_directory(data):
    rows = {}; offset = 0
    while offset < len(data):
        if offset + 46 > len(data) or data[offset:offset + 4] != b"PK\x01\x02":
            raise ValueError("Malformed ZIP central directory")
        fields = struct.unpack_from("<4s6H3I5H2I", data, offset)
        flags, method, crc32, compressed, uncompressed = fields[3], fields[4], fields[7], fields[8], fields[9]
        name_size, extra_size, comment_size, disk, local_offset = fields[10], fields[11], fields[12], fields[13], fields[16]
        stop = offset + 46 + name_size + extra_size + comment_size
        if stop > len(data) or disk != 0 or flags & 1 or compressed == 0xFFFFFFFF or uncompressed == 0xFFFFFFFF or local_offset == 0xFFFFFFFF:
            raise ValueError("Unsupported or truncated ZIP central entry")
        name = data[offset + 46:offset + 46 + name_size].decode("utf-8" if flags & 0x800 else "cp437")
        if name in rows:
            raise ValueError("Duplicate archive member identity")
        rows[name] = {"name": name, "flags": flags, "method": method, "crc32": crc32, "compressed_bytes": compressed, "uncompressed_bytes": uncompressed, "local_offset": local_offset}
        offset = stop
    return rows


def read_directory(fetcher, name):
    size = ARCHIVES[name]["bytes"]
    start = max(0, size - 65557)
    tail = fetcher.fetch(name, start, size - 1)
    end = tail.rfind(b"PK\x05\x06")
    if end < 0 or end + 22 > len(tail):
        raise ValueError("ZIP end-of-directory not found")
    fields = struct.unpack_from("<4s4H2IH", tail, end)
    disk, cd_disk, disk_entries, entries, cd_size, cd_offset, comment_size = fields[1:]
    if disk or cd_disk or disk_entries != entries or entries == 0xFFFF or cd_size < 1 or cd_size > MAX_DIRECTORY_BYTES or cd_offset + cd_size > start + end or end + 22 + comment_size != len(tail):
        raise ValueError("Unsupported or malformed ZIP end-of-directory")
    directory = tail[cd_offset - start:cd_offset - start + cd_size] if cd_offset >= start else fetcher.fetch(name, cd_offset, cd_offset + cd_size - 1)
    rows = parse_directory(directory)
    if len(rows) != entries:
        raise ValueError("Central-directory entry count mismatch")
    return rows


def decode_member(compressed, row):
    expected = row["uncompressed_bytes"]
    if row["compressed_bytes"] < 1 or row["compressed_bytes"] > MAX_MEMBER_BYTES or expected < 1 or expected > MAX_MEMBER_BYTES or len(compressed) != row["compressed_bytes"]:
        raise ValueError("Selected member exceeds byte bounds")
    if row["method"] == 0:
        data = compressed
    elif row["method"] == 8:
        decoder = zlib.decompressobj(-15)
        data = decoder.decompress(compressed, expected + 1)
        if len(data) > expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError("Truncated, oversized or trailing compressed member")
    else:
        raise ValueError("Unsupported ZIP compression method")
    if len(data) != expected or zlib.crc32(data) & 0xFFFFFFFF != row["crc32"]:
        raise ValueError("Original ZIP member size or CRC32 mismatch")
    return data


def fetch_member(fetcher, archive_name, row):
    offset = row["local_offset"]
    header = fetcher.fetch(archive_name, offset, offset + 29)
    fields = struct.unpack("<4s5H3I2H", header)
    if fields[0] != b"PK\x03\x04" or fields[2] != row["flags"] or fields[3] != row["method"]:
        raise ValueError("Local/central ZIP header mismatch")
    name_size, extra_size = fields[-2:]
    if name_size < 1 or name_size + extra_size > 65535:
        raise ValueError("Invalid selected ZIP local header lengths")
    extra = fetcher.fetch(archive_name, offset + 30, offset + 30 + name_size + extra_size - 1)
    actual_name = extra[:name_size].decode("utf-8" if row["flags"] & 0x800 else "cp437")
    if actual_name != row["name"]:
        raise ValueError("Selected local ZIP member has another identity")
    start = offset + 30 + name_size + extra_size
    compressed = fetcher.fetch(archive_name, start, start + row["compressed_bytes"] - 1)
    return decode_member(compressed, row)


def fetch_references(data_root, output, download=False, fetcher=None):
    data_root, output = Path(data_root).resolve(), Path(output).resolve()
    if output == data_root or data_root not in output.parents or data_root.name != ".training-data":
        raise ValueError("Output must be a child of the ignored .training-data directory")
    selections, provenance = select_references(data_root)
    fetcher = fetcher or BoundedFetcher()
    indexes = {name: read_directory(fetcher, name) for name in ARCHIVES}
    for row in selections:
        matches = [(name, entries[row["clip_id"]]) for name, entries in indexes.items() if row["clip_id"] in entries]
        if len(matches) != 1:
            raise ValueError("Selected official clip does not have exactly one archive member")
        archive_name, entry = matches[0]
        if entry["compressed_bytes"] < 1 or entry["compressed_bytes"] > MAX_MEMBER_BYTES or entry["uncompressed_bytes"] < 1 or entry["uncompressed_bytes"] > MAX_MEMBER_BYTES:
            raise ValueError("Selected official clip exceeds the bounded member size")
        row.update(entry)
        row.update({"archive": archive_name, "archive_bytes": ARCHIVES[archive_name]["bytes"], "archive_expected_md5": ARCHIVES[archive_name]["md5"], "archive_full_md5_verified": False,
                    "url": f"https://zenodo.org/api/records/4010759/files/{archive_name}/content"})
    if sum(row["compressed_bytes"] for row in selections) > MAX_TOTAL_MEMBER_BYTES:
        raise ValueError("Selected video total exceeds the download bound")
    manifest = {"format": "signbridge-include-reference-audit-v1", "source_record": SOURCE_RECORD, "license": "CC BY 4.0",
                "official_card": "https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md",
                "attribution": "Sridhar, Ganesan, Kumar and Khapra. INCLUDE: A Large Scale Dataset for Indian Sign Language Recognition (2020). DOI 10.1145/3394171.3413528",
                "selection_provenance": provenance, "clips": selections,
                "scope": "Four frozen raw-video references. Official-test clips replay-only; never fit, choose architecture, calibrate rejection or force expected words.",
                "integrity_limits": "Partial ranges verify exact Content-Range/size and original member CRC32. SHA256 is computed locally and re-read after save; no upstream per-video SHA256 exists and full archive MD5 is not verified.",
                "signer_limit": "Official recording split only. ISL signer identifiers unavailable; no signer-disjoint or webcam accuracy claim.",
                "downloaded": False, "range_bytes_downloaded": fetcher.bytes_downloaded}
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / "manifest.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf8"))
        if previous.get("selection_provenance") != provenance or [row.get("clip_id") for row in previous.get("clips", [])] != [row["clip_id"] for row in selections]:
            raise ValueError("Refusing to overwrite a different frozen reference selection")
        for row, prior in zip(selections, previous["clips"]):
            for key in ("local_file", "archive", "crc32", "compressed_bytes", "uncompressed_bytes", "local_offset"):
                if row[key] != prior.get(key):
                    raise ValueError("Frozen reference source metadata changed")
            if prior.get("sha256"):
                path = output / row["local_file"]
                if not path.is_file() or path.stat().st_size != row["uncompressed_bytes"] or digest_file(path) != prior["sha256"]:
                    raise ValueError("Previously downloaded reference hash or size changed")
                row.update({key: prior[key] for key in ("sha256", "sha256_source", "crc32_verified", "saved_hash_verified")})
        if previous.get("downloaded"):
            if not all(row.get("sha256") for row in selections):
                raise ValueError("Downloaded manifest is missing a verified reference hash")
            return previous
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    if not download:
        return manifest
    for row in selections:
        destination = output / row["local_file"]
        if row.get("sha256"):
            continue
        if destination.exists():
            raise ValueError("Refusing to overwrite an unverified existing reference")
        data = fetch_member(fetcher, row["archive"], row)
        digest = hashlib.sha256(data).hexdigest()
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            temporary.write_bytes(data)
            if temporary.stat().st_size != row["uncompressed_bytes"] or digest_file(temporary) != digest:
                raise ValueError("Saved local reference hash/size differs from verified bytes")
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        row.update({"sha256": digest, "sha256_source": "computed local decompressed bytes; re-read after save", "crc32_verified": True, "saved_hash_verified": True})
        manifest["range_bytes_downloaded"] = fetcher.bytes_downloaded
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
        print(json.dumps({"clip_id": row["clip_id"], "split": row["split"], "bytes": len(data), "sha256": digest, "crc32_verified": True}), flush=True)
    manifest["downloaded"] = True
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=Path(".training-data"))
    parser.add_argument("--output", type=Path, default=Path(".training-data/reference-video-audit-2026-10-11"))
    parser.add_argument("--download", action="store_true", help="Fetch exactly the four frozen selected video members; otherwise fetch only ZIP indexes and save the plan")
    args = parser.parse_args()
    manifest = fetch_references(args.data_root, args.output, args.download)
    print(json.dumps({"downloaded": manifest["downloaded"], "clip_count": len(manifest["clips"]), "compressed_video_bytes": sum(row["compressed_bytes"] for row in manifest["clips"]), "range_bytes_downloaded": manifest["range_bytes_downloaded"], "manifest": str(args.output / "manifest.json")}), flush=True)


if __name__ == "__main__":
    main()
