"""Bounded, stdlib-only declared-coordinate preflight for new temporal studies.

This checks a data-bound declaration, not original-pose conversion, audit-report
contents, browser parity, signer independence or sign accuracy. Historical graph
studies and their prepared-data loader deliberately do not use this gate.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

FORMAT = "signbridge-temporal-coordinates-v1"
MAX_METADATA_BYTES = 1024 * 1024
MAX_DATA_BYTES = 512 * 1024 * 1024
LIMIT = ("Declared provenance only: original poses, referenced audit-report contents and browser parity "
         "are not verified; feature arrays and signer groups require the separate training checks.")
FIELDS = {"format", "canonicalSpace", "axes", "cameraSpace", "conversionStage", "source", "conversion",
          "preparedDataSha256", "auditReportSha256"}


def file_sha256(path, maximum=MAX_DATA_BYTES):
    path = Path(path)
    if not path.is_file() or not 0 < path.stat().st_size <= maximum:
        raise ValueError("Prepared source is missing, empty or exceeds its bounded file size")
    digest, count = hashlib.sha256(), 0
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            count += len(block)
            if count > maximum:
                raise ValueError("Prepared source exceeded its bounded file size while reading")
            digest.update(block)
    return digest.hexdigest()


def validate_coordinate_provenance(value, data_hash):
    if value is None:
        raise ValueError("Temporal training requires coordinateProvenance metadata. Prepare a new explicitly "
                         "canonicalized dataset; do not annotate historical arrays as already converted.")
    if not isinstance(value, dict) or set(value) != FIELDS or value.get("format") != FORMAT:
        raise ValueError("Unsupported or incomplete temporal coordinateProvenance schema")
    if (value["canonicalSpace"] != "normalized-image" or value["cameraSpace"] != "normalized-image" or
            value["axes"] != "x-right-y-down" or value["conversionStage"] != "before-shoulder-normalization"):
        raise ValueError("Temporal coordinates must declare canonical camera XY before shoulder normalization")
    source = value["source"]
    if not isinstance(source, dict) or set(source) != {"space", "scaleX", "scaleY"}:
        raise ValueError("Declare one explicit source XY convention; mixed or inferred conventions are unsupported")
    if any(type(source[key]) is not int or not 1 <= source[key] <= 16384 for key in ("scaleX", "scaleY")):
        raise ValueError("Source coordinate divisors must be bounded positive integers")
    identity = source["scaleX"] == source["scaleY"] == 1
    if not ((source["space"] == "normalized-image" and identity and value["conversion"] == "identity") or
            (source["space"] == "axis-scaled-image" and not identity and value["conversion"] == "divide-xy")):
        raise ValueError("Source space, divisors and declared XY conversion are inconsistent")
    for key in ("preparedDataSha256", "auditReportSha256"):
        if not isinstance(value[key], str) or re.fullmatch(r"[a-f0-9]{64}", value[key]) is None:
            raise ValueError("Coordinate provenance needs lowercase SHA-256 data and audit-report references")
    if value["preparedDataSha256"] != data_hash:
        raise ValueError("Coordinate declaration is bound to different prepared data; regenerate its provenance")
    # Return only the validated exact schema, without retaining caller-owned objects.
    return {**value, "source": dict(source)}


def coordinate_preflight(data_path, language):
    """Read/hash bounded source files only; never load NPZ arrays or write output."""
    data_path = Path(data_path)
    if language not in ("isl", "asl") or data_path.suffix.lower() != ".npz":
        raise ValueError("Choose ISL/ASL and a prepared .npz source for temporal preflight")
    metadata_path = data_path.with_suffix(".metadata.json")
    if not metadata_path.is_file() or not 0 < metadata_path.stat().st_size <= MAX_METADATA_BYTES:
        raise ValueError("Prepared .metadata.json is missing, empty or exceeds 1 MiB")
    with metadata_path.open("rb") as source:
        raw = source.read(MAX_METADATA_BYTES + 1)
    if len(raw) > MAX_METADATA_BYTES:
        raise ValueError("Prepared metadata exceeded 1 MiB while reading")
    try:
        metadata = json.loads(raw)
    except (ValueError, UnicodeError, RecursionError):
        raise ValueError("Prepared metadata must be bounded valid JSON") from None
    if not isinstance(metadata, dict) or metadata.get("language", metadata.get("signLanguage")) != language:
        raise ValueError("Prepared metadata language differs from the requested temporal study")
    # Check the declaration first so an unannotated archive is not even hashed.
    declaration = metadata.get("coordinateProvenance")
    if declaration is None:
        validate_coordinate_provenance(None, "")
    if metadata.get("featureContract") != "signbridge-pose75-xyc-v1":
        raise ValueError("Temporal coordinate preflight requires the pose75 feature contract")
    data_hash = file_sha256(data_path)
    provenance = validate_coordinate_provenance(declaration, data_hash)
    return {"format": "signbridge-temporal-coordinate-preflight-v1", "declaredProvenanceValid": True,
            "conversionIndependentlyVerified": False, "dataSha256": data_hash,
            "metadataSha256": hashlib.sha256(raw).hexdigest(), "coordinateProvenance": provenance,
            "featureArraysRead": False, "signerGroupsChecked": False, "trainingPerformed": False,
            "limits": LIMIT}
