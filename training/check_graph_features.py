"""Build ignored real-validation feature fixtures, then check actual JS parity.

Raw pose fixtures remain under ignored .training-data. Only aggregate numerical
results are written to a requested shareable report. Does not infer final tests.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from pose_graph import CONTRACT_ID, adjacency_hash, contract_hash, normalize_features, preprocess_pose_graph
from prepare_graph_data import read_only_archive, sha256_file


def make_fixtures(language, source_root, destination):
    graph_directory = source_root / "graph-v1" / language
    metadata_path = graph_directory / f"{language}.metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata["contractHash"] != contract_hash() or metadata["adjacencyHash"] != adjacency_hash():
        raise ValueError("Prepared graph contract is incompatible")
    legacy_path = source_root / "prepared" / f"{language}.npz"
    archive_path = source_root / "archives" / ("INCLUDE.zip" if language == "isl" else "WLASL.zip")
    if sha256_file(legacy_path) != metadata["sources"]["sha256"]["legacyPrepared"] or sha256_file(archive_path) != metadata["sources"]["sha256"]["archive"]:
        raise ValueError("Source corpus changed after graph preparation")
    with np.load(legacy_path, allow_pickle=False) as data:
        selected, seen = [], set()
        for index, target in enumerate(data["y_val"].tolist()):
            if target not in seen:
                seen.add(target)
                selected.append(str(data["clip_ids_val"][index]))
            if len(selected) == 3:
                break
    if len(selected) != 3:
        raise ValueError("At least three validation classes are needed for parity")
    cases = []
    with tempfile.TemporaryDirectory(prefix=".graph-parity-", dir=destination.parent) as working:
        with read_only_archive(archive_path, working) as archive:
            for index, clip in enumerate(selected):
                pose = archive.read(clip)
                features, mask = preprocess_pose_graph(pose["keypoints"], pose["confidences"])
                normalization = metadata["normalization"]
                cases.append({"name": f"{language}-validation-{index + 1}", "split": "val",
                    "sourceClipHash": hashlib.sha256(clip.encode()).hexdigest(),
                    "frames": [{"keypoints": points.tolist(), "confidences": confidence.tolist()}
                               for points, confidence in zip(pose["keypoints"], pose["confidences"])],
                    "features": features.tolist(), "mask": mask.tolist(), "normalization": normalization,
                    "normalized": normalize_features(features, mask, normalization).tolist()})
    fixtures = {"format": "signbridge-graph-feature-fixtures-v1", "synthetic": False, "signLanguage": language,
                "featureContract": CONTRACT_ID, "contractHash": contract_hash(), "adjacencyHash": adjacency_hash(), "cases": cases}
    with destination.open("x", encoding="utf-8") as target:
        json.dump(fixtures, target, separators=(",", ":"), allow_nan=False)
        target.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=["both", "isl", "asl"], default="both")
    parser.add_argument("--fixtures-dir", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[1]
    source_root = repository / ".training-data"
    destination = (args.fixtures_dir or source_root / "graph-v1" / "parity").resolve()
    if destination.exists() or args.report.exists():
        parser.error("Use new fixture/report paths; existing evidence is never overwritten")
    destination.mkdir(parents=True, exist_ok=False)
    languages = ["isl", "asl"] if args.language == "both" else [args.language]
    for language in languages:
        make_fixtures(language, source_root, destination / f"{language}-features.json")
    subprocess.run(["node", "training/check-graph-parity.mjs", "--fixtures-dir", str(destination),
                    "--report", str(args.report.resolve()), *languages], cwd=repository, check=True, timeout=60)


if __name__ == "__main__":
    main()
