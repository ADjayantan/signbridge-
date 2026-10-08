"""Freeze the bounded experiment before training; no raw poses are published."""
import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def freeze(root, output):
    if output.exists():
        raise ValueError('Protocol already frozen; do not silently overwrite it')
    sources = {}
    for language, archive in [('isl', 'INCLUDE.zip'), ('asl', 'WLASL.zip')]:
        data = root / '.training-data' / 'prepared' / f'{language}.npz'
        metadata = data.with_suffix('.metadata.json')
        model = root / 'public' / 'models' / f'{language}.json'
        with np.load(data, allow_pickle=False) as prepared:
            labels = prepared['labels'].tolist()
            counts = Counter(prepared['y_train'].tolist())
            splits = {}
            seen = set()
            for split in ['train', 'val', 'test', 'unknown_validation', 'unknown_test']:
                ids = prepared[f'clip_ids_{split}'].tolist()
                if len(ids) != len(set(ids)) or seen.intersection(ids):
                    raise ValueError(f'{language}: split overlap or duplicate clips')
                seen.update(ids)
                splits[split] = {'count': len(ids), 'ordered_clip_ids_sha256': hashlib.sha256(json.dumps(ids, separators=(',', ':')).encode()).hexdigest()}
            demo = sorted(range(len(labels)), key=lambda i: (-counts[i], labels[i]))[:20]
            sources[language] = {
                'classes': len(labels), 'splits': splits,
                'demonstration_labels': [labels[i] for i in demo],
                'demonstration_selection': 'Top20 train counts, label lexical tie break, before candidate test inspection',
                'sha256': {'archive': sha256(root / '.training-data' / 'archives' / archive), 'prepared': sha256(data), 'metadata': sha256(metadata), 'legacy_model': sha256(model)},
            }
    protocol = {
        'format': 'signbridge-graph-experiment-v1', 'created_utc': datetime.now(timezone.utc).isoformat(),
        'feature_contract': 'signbridge-pose75-xyc-v1', 'feature_shape': [32, 75, 3],
        'valid_joint_confidence': .5, 'shoulder_confidence': .2,
        'resampling': 'nearest index floor(i*(T-1)/31+0.5), trimmed hand-visible interval',
        'coordinate_clip': [-5, 5], 'normalization': 'Valid-training-only XY mean/std, std floor .05, embedded model, missing nodes remasked; confidence never standardized',
        'models': ['gru27', 'gru75', 'stgcn'], 'seeds': [42, 43, 44],
        'training': {'epoch_ceiling': 80, 'early_stop_minimum_epoch': 20, 'patience': 20, 'batch_size': 64, 'optimizer': 'AdamW', 'learning_rate': .002, 'weight_decay': .0001, 'augmentation': 'none', 'checkpoint_metric': 'validation macro recall', 'cpu_threads': 4},
        'calibration': {'confidence_grid': {'start': .5, 'end': .99, 'step': .01}, 'margin_grid': {'start': .05, 'end': .5, 'step': .05}, 'minimum_known_precision': .95, 'minimum_correct_known_coverage': .6, 'maximum_unknown_false_accept_rate': .05, 'objective': 'Maximize accepted-correct validation coverage after precision/FAR screening; tie fewer known mistakes, fewer unknown accepts, stricter threshold then margin; zero eligible point disables acceptance'},
        'selection': 'Same architecture across seeds chosen per language by validation; only qualifying architecture with >=5pp mean accepted-correct coverage improvement over calibrated GRU27 control considered, then frozen final test/parity/runtime gates',
        'camera_gate': {'minimum_samples': 4, 'minimum_hand_and_shoulder_samples': 4, 'minimum_duration_ms': 350, 'maximum_duration_ms': 12000, 'maximum_samples': 100, 'maximum_sample_gap_ms': 1000, 'strict_monotonic_timestamps': True},
        'test_policy': 'Historical test already inspected previously; final outputs are one frozen confirmatory benchmark, never unseen-signer or live accuracy; no architecture changes after candidate test inspection',
        'sources': sources, 'limitations': ['No facial mesh/z features', 'ISL signer IDs absent', 'Legacy ASL signer overlap; signer-disjoint study deferred if not feasible', 'Fluent/live camera evaluation pending'],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(protocol, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({'protocol': str(output), 'sha256': sha256(output), 'languages': {k: {'classes': v['classes'], 'splits': v['splits']} for k, v in sources.items()}}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    freeze(Path(__file__).resolve().parents[1], args.output)
