"""Freeze validation selection, then perform one recorded final benchmark.

Never promotes an artifact. Device/browser/fluent evidence is separate.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from evaluate_graph_models import calibrate_run, metrics, per_word
from freeze_graph_experiment import sha256
from graph_models import load_checkpoint
from train_graph_models import predict

ARCHITECTURES = ['gru27', 'gru75', 'stgcn']
SEEDS = [42, 43, 44]


def write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as output:
        output.write(json.dumps(value, indent=2, allow_nan=False) + '\n')


def freeze_selection(run_root, output, legacy_path=None):
    if output.exists():
        raise FileExistsError('Selection already frozen')
    rows = []
    language = None
    data_hash = None
    budget = None
    legacy_hash = None
    for architecture in ARCHITECTURES:
        for seed in SEEDS:
            folder = run_root / f'{architecture}-seed{seed}'
            run = json.loads((folder / 'run.json').read_text(encoding='utf-8'))
            language = language or run['signLanguage']
            if run['signLanguage'] != language or run['architecture'] != architecture or run['seed'] != seed:
                raise ValueError('Run identity mismatch')
            if sha256(folder / 'checkpoint.pt') != run['weightsSha256']:
                raise ValueError('Checkpoint changed before selection')
            if data_hash is not None and run['dataSha256'] != data_hash:
                raise ValueError('Compared runs use different prepared data')
            if budget is not None and run['budget'] != budget:
                raise ValueError('Compared runs use different optimization budgets')
            data_hash, budget = run['dataSha256'], run['budget']
            experiment_path = Path(run['checkpoint']).parent.parent / 'experiment.json'
            if sha256(experiment_path) != run['experimentSha256']:
                raise ValueError('Training experiment changed')
            experiment = json.loads(experiment_path.read_text(encoding='utf-8'))
            if experiment['dataSha256'] != data_hash or experiment['signLanguage'] != language:
                raise ValueError('Training experiment data/language mismatch')
            if architecture == 'gru27':
                expected_legacy = experiment['legacyDataSha256']
                if legacy_hash is not None and expected_legacy != legacy_hash:
                    raise ValueError('Control runs use different legacy data')
                legacy_hash = expected_legacy
            calibration = calibrate_run(folder)
            rows.append({'architecture': architecture, 'seed': seed, 'weights_sha256': run['weightsSha256'], 'run_json_sha256': sha256(folder / 'run.json'), 'validation_predictions_sha256': sha256(folder / 'validation-predictions.npz'), 'calibration_sha256': sha256(folder / 'calibration.json'), 'calibration': calibration, 'validation_macro_recall': run['bestValidationMacroRecall'], 'epochs': run['epochsRun'], 'training_seconds': run['trainingSeconds'], 'parameters': run['parameters'], 'stop_reason': run['stopReason']})
    summaries = {}
    for architecture in ARCHITECTURES:
        group = [r for r in rows if r['architecture'] == architecture]
        coverage = [r['calibration']['metrics']['correct_known_coverage'] for r in group]
        summaries[architecture] = {'mean_correct_coverage': float(np.mean(coverage)), 'coverage_range': [min(coverage), max(coverage)], 'all_seeds_screen_passed': all(r['calibration']['screen_passed'] for r in group), 'mean_macro_recall': float(np.mean([r['validation_macro_recall'] for r in group]))}
    reference = summaries['gru27']['mean_correct_coverage']
    eligible = [a for a in ['gru75', 'stgcn'] if summaries[a]['all_seeds_screen_passed'] and summaries[a]['mean_correct_coverage'] - reference >= .05 - 1e-12]
    chosen = max(eligible, key=lambda a: (summaries[a]['mean_correct_coverage'], summaries[a]['mean_macro_recall'], a == 'gru75')) if eligible else None
    root = Path(__file__).resolve().parents[1]
    legacy_path = legacy_path or root / '.training-data' / 'prepared' / f'{language}.npz'
    if sha256(legacy_path) != legacy_hash:
        raise ValueError('Legacy prepared data changed after control training')
    result = {'format': 'signbridge-frozen-selection-v1', 'language': language, 'run_root': str(run_root.resolve()), 'stage': 'validation-only selection, before candidate final test', 'prepared_data_sha256': data_hash, 'legacy_prepared_path': str(legacy_path.resolve()), 'legacy_prepared_sha256': legacy_hash, 'budget': budget, 'selected_architecture': chosen, 'representative_seed': 42, 'selection_rule': 'All3 validation seeds meet screens and mean accepted-correct coverage improves >=5pp over GRU27; highest mean coverage then macro recall, GRU75 tie; representative seed42 fixed', 'summaries': summaries, 'runs': rows, 'promotion': False, 'reason': 'No eligible candidate' if chosen is None else 'Final test/runtime/device gates still required', 'test_previously_inspected': True}
    write_new(output, result)
    return result


def final_benchmark(selection_file, output):
    if output.exists():
        raise FileExistsError('Final benchmark already recorded; do not repeat test selection')
    selection = json.loads(selection_file.read_text(encoding='utf-8'))
    language = selection['language']
    run_root = Path(selection['run_root'])
    rows = []
    legacy_path = Path(selection['legacy_prepared_path'])
    if sha256(legacy_path) != selection['legacy_prepared_sha256']:
        raise ValueError('Legacy prepared data changed after selection freeze')
    with np.load(legacy_path, allow_pickle=False) as source:
        old = {key: source[key].copy() for key in ['labels', 'y_test', 'X_test', 'X_unknown_test', 'clip_ids_test', 'clip_ids_unknown_test']}
    torch.set_num_threads(4)
    for frozen in selection['runs']:
        folder = run_root / f"{frozen['architecture']}-seed{frozen['seed']}"
        for name, expected in [('checkpoint.pt', frozen['weights_sha256']), ('run.json', frozen['run_json_sha256']), ('validation-predictions.npz', frozen['validation_predictions_sha256']), ('calibration.json', frozen['calibration_sha256'])]:
            if sha256(folder / name) != expected:
                raise ValueError(f'Frozen run file changed: {name}')
        model, run = load_checkpoint(folder / 'checkpoint.pt')
        data_path = Path(run['prepared_data'])
        if run['dataSha256'] != selection['prepared_data_sha256'] or sha256(data_path) != run['dataSha256']:
            raise ValueError('Prepared data changed after training')
        with np.load(data_path, allow_pickle=False) as dataset:
            labels = dataset['labels'].tolist()
            if labels != old['labels'].tolist() or labels != run['labels']:
                raise ValueError('Final vocabulary order changed')
            targets = dataset['y_test'].copy()
            if frozen['architecture'] == 'gru27':
                arrays = []
                for split in ['test', 'unknown_test']:
                    lookup = {clip: i for i, clip in enumerate(old[f'clip_ids_{split}'].tolist())}
                    indices = [lookup[clip] for clip in dataset[f'clip_ids_{split}'].tolist()]
                    if split == 'test' and not np.array_equal(old['y_test'][indices], targets):
                        raise ValueError('Control target/clip identity changed')
                    arrays.append(old[f'X_{split}'][indices].astype(np.float32))
                features, unknown_features = arrays
            else:
                features = dataset['X_test'].astype(np.float32)
                unknown_features = dataset['X_unknown_test'].astype(np.float32)
        scores = predict(model, torch.from_numpy(features))
        unknown_scores = predict(model, torch.from_numpy(unknown_features))
        point = frozen['calibration']
        m = metrics(scores, targets, unknown_scores, point['threshold'], point['margin'], point['acceptanceEnabled'])
        passed = bool(point['acceptanceEnabled'] and m['known_accepted_precision'] is not None and m['known_accepted_precision'] >= .95 and m['correct_known_coverage'] >= .6 and m['unknown_false_accept_rate'] <= .05)
        rows.append({'architecture': frozen['architecture'], 'seed': frozen['seed'], 'threshold': point['threshold'], 'margin': point['margin'], 'acceptance_enabled': point['acceptanceEnabled'], 'test_screen_passed': passed, 'metrics': m, 'per_word': per_word(scores, targets, point['threshold'], point['margin'], labels, point['acceptanceEnabled'])})
    means = {a: float(np.mean([r['metrics']['correct_known_coverage'] for r in rows if r['architecture'] == a])) for a in ARCHITECTURES}
    chosen = selection['selected_architecture']
    final_pass = bool(chosen and all(r['test_screen_passed'] for r in rows if r['architecture'] == chosen) and means[chosen] - means['gru27'] >= .05 - 1e-12)
    result = {'format': 'signbridge-final-benchmark-v1', 'language': language, 'frozen_selection_sha256': sha256(selection_file), 'selected_architecture': chosen, 'representative_seed': 42, 'candidate_dataset_gate_passed': final_pass, 'test_mean_correct_coverage': means, 'runs': rows, 'promoted': False, 'remaining_gates': ['PyTorch/ONNX/WebWASM parity', 'Actual Chrome camera/device performance/lifecycle run sheet', 'Fluent-signer/live accuracy not established'], 'limits': ['Previously inspected historical benchmark', 'Unknown signs are not nonsigning negatives', 'No sentence translation', 'Seeds are correlated predictions of the same clips; never pool as independent test samples']}
    write_new(output, result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-root', type=Path)
    parser.add_argument('--selection', type=Path, required=True)
    parser.add_argument('--legacy-data', type=Path)
    parser.add_argument('--final-report', type=Path)
    args = parser.parse_args()
    if args.final_report:
        report = final_benchmark(args.selection, args.final_report)
        print(json.dumps({k: v for k, v in report.items() if k != 'runs'}, allow_nan=False))
    else:
        if args.run_root is None:
            parser.error('--run-root is required to freeze validation selection')
        report = freeze_selection(args.run_root, args.selection, args.legacy_data)
        print(json.dumps({k: v for k, v in report.items() if k != 'runs'}, allow_nan=False))
