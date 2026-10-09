"""Record a bounded matched ASL experiment before training or predictions."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np

from freeze_graph_experiment import sha256
from pose_graph import SPLITS
from train_graph_models import load_data


def identity_hash(values):
    return hashlib.sha256(json.dumps(values, separators=(',', ':')).encode()).hexdigest()


def freeze(graph, legacy, strict_protocol, inventory, output):
    graph, legacy, strict_protocol, inventory, output = map(Path, (graph, legacy, strict_protocol, inventory, output))
    if output.exists():
        raise FileExistsError('Comparison protocol already recorded')
    report = json.loads(inventory.read_text(encoding='utf-8'))
    if (report.get('strictNegatives') is not True or report.get('studyAvailable') is not True
            or report.get('selectionAndTestSignerOverlap') != 0
            or report.get('strictProtocolHash') != sha256(strict_protocol)):
        raise ValueError('A verified strict signer study is required')
    if report['dataHashes'] != {'graph': sha256(graph), 'legacy': sha256(legacy)}:
        raise ValueError('Prepared signer-study data changed')
    labels, _, _, _, _ = load_data(graph, 'asl', legacy)
    splits, groups, seen = {}, {}, set()
    # Identities/signer metadata only: no final test features or targets inspected.
    with np.load(graph, allow_pickle=False) as new, np.load(legacy, allow_pickle=False) as old:
        if old['labels'].tolist() != labels:
            raise ValueError('Compared vocabularies differ')
        for split in SPLITS:
            ids = new[f'clip_ids_{split}'].tolist()
            signer_ids = new[f'signer_ids_{split}']
            if (not ids or len(set(ids)) != len(ids) or seen.intersection(ids)
                    or not np.array_equal(old[f'clip_ids_{split}'], new[f'clip_ids_{split}'])
                    or not np.array_equal(old[f'signer_ids_{split}'], signer_ids)
                    or signer_ids.shape != (len(ids),) or signer_ids.dtype.kind not in 'iu'
                    or np.any(signer_ids < 0)):
                raise ValueError('Invalid or unmatched study identities')
            seen.update(ids)
            groups[split] = set(signer_ids.tolist())
            splits[split] = {'count': len(ids), 'signers': len(groups[split]),
                             'orderedClipIdsSha256': identity_hash(ids)}
        if (groups['train'] & groups['val'] or groups['train'] & groups['unknown_validation']
                or (groups['train'] | groups['val'] | groups['unknown_validation'])
                   & (groups['test'] | groups['unknown_test'])):
            raise ValueError('Signer leakage across fitting/selection and test')
        if min(splits[name]['count'] for name in ('unknown_validation', 'unknown_test')) < 20:
            raise ValueError('Insufficient genuine negative holdout')
    value = {
        'format': 'signbridge-asl-signer-comparison-protocol-v1', 'signLanguage': 'asl',
        'recordedAt': datetime.now(timezone.utc).isoformat(),
        'models': ['gru27', 'gru75'], 'seeds': [42, 43, 44],
        'dataSha256': sha256(graph), 'legacyDataSha256': sha256(legacy),
        'metadataSha256': sha256(graph.with_suffix('.metadata.json')),
        'legacyMetadataSha256': sha256(legacy.with_suffix('.metadata.json')),
        'strictProtocolSha256': sha256(strict_protocol), 'inventorySha256': sha256(inventory),
        'inventoryPath': str(inventory.resolve()),
        'paths': {'graph': str(graph.resolve()), 'legacy': str(legacy.resolve()),
                  'strictProtocol': str(strict_protocol.resolve()), 'inventory': str(inventory.resolve())},
        'labelsSha256': identity_hash(labels), 'classes': len(labels), 'splits': splits,
        'training': {'epochs': 80, 'minimumEpochs': 20, 'patience': 20, 'batchSize': 64,
                     'learningRate': .002, 'weightDecay': .0001, 'maxSeconds': 1200, 'threads': 4},
        'augmentation': 'none', 'checkpoint': 'Validation macro recall; tie lower validation loss',
        'calibration': {'confidence': [.50, .99, .01], 'margin': [.05, .50, .05],
                        'selection': 'Maximize correctly accepted validation coverage after precision/FAR screening; existing fixed grid and tie rules'},
        'acceptance': {'minimumKnownPrecision': .95, 'minimumCorrectKnownCoverage': .60,
                       'maximumUnknownFalseAcceptRate': .05},
        'minimumCoverageImprovement': .05, 'representativeSeed': 42,
        'selection': 'GRU75 eligible only if all3 seeds pass validation screens and mean correct coverage improves >=5pp over matched GRU27; freeze before one final comparison',
        'trained': False, 'testPredictionsPerformed': False, 'promoted': False,
        'limits': ['Signer-isolated partition of previously inspected historical corpus; not newly collected or untouched recordings',
                   'Only 40 calibration and 112 test out-of-vocabulary negatives; correlated clips and one shared unknown word',
                   'No idle-camera negatives, facial/depth features, sentences, live-device or fluent-user validation',
                   'Compare only within this matched split; never treat historical-split scores as a matched control',
                   'Model improvement and promotion are not guaranteed; runtime/device/distribution gates remain required'],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as target:
        target.write(json.dumps(value, indent=2, allow_nan=False) + '\n')
    return value


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph-data', type=Path, required=True)
    parser.add_argument('--legacy-data', type=Path, required=True)
    parser.add_argument('--strict-protocol', type=Path, required=True)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = freeze(args.graph_data, args.legacy_data, args.strict_protocol, args.inventory, args.output)
    print(json.dumps({'protocol': str(args.output), 'sha256': sha256(args.output), 'classes': result['classes'], 'splits': result['splits']}))
