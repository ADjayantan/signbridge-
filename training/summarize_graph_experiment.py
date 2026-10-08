"""Publish aggregate frozen results; individual poses/checkpoints stay ignored."""
import argparse
import csv
import json
from pathlib import Path
import statistics


def summarize(directory):
    rows, word_rows = [], []
    for language in ['isl', 'asl']:
        selection = json.loads((directory / f'{language}-selection.json').read_text(encoding='utf-8'))
        final = json.loads((directory / f'{language}-final.json').read_text(encoding='utf-8'))
        for run in final['runs']:
            metric = run['metrics']
            frozen = next(r for r in selection['runs'] if r['architecture'] == run['architecture'] and r['seed'] == run['seed'])
            rows.append({'language': language, 'architecture': run['architecture'], 'seed': run['seed'], 'epochs': frozen['epochs'], 'stop_reason': frozen['stop_reason'], 'training_seconds': frozen['training_seconds'], 'parameters': frozen['parameters'], 'threshold': run['threshold'], 'margin': run['margin'], 'acceptance_enabled': run['acceptance_enabled'], **{key: metric[key] for key in ['known_count', 'unknown_count', 'top1_accuracy', 'macro_recall', 'accepted_correct', 'accepted_wrong', 'known_rejected', 'known_accepted_precision', 'correct_known_coverage', 'unknown_false_accepts', 'unknown_false_accept_rate', 'mixture_precision']}})
            word_rows.extend({'language': language, 'architecture': run['architecture'], 'seed': run['seed'], **word} for word in run['per_word'])
    for name, records in [('runs.csv', rows), ('per-word.csv', word_rows)]:
        with (directory / name).open('x', encoding='utf-8', newline='') as output:
            writer = csv.DictWriter(output, fieldnames=list(records[0]))
            writer.writeheader(); writer.writerows(records)
    lines = ['# Joint-model experiment — 4 October 2026', '',
        '**18 seeded training runs completed. No candidate passed promotion; app research weights remain unchanged.**', '',
        'Three architectures, seeds42/43/44, identical80-epoch/1200-second ceilings, validation-based early stopping and calibration. Test was evaluated after frozen selection. Profiling/untrained spikes are excluded. Historical test recordings were previously inspected; these are not new live or unfamiliar-signer accuracy measurements.', '',
        '| Language | Model | Test top-1 mean (seed range) | Correctly accepted known coverage, mean | Unknown false accepts, seeds42/43/44 |',
        '| --- | --- | --- | --- | --- |']
    for language in ['isl', 'asl']:
        for architecture in ['gru27', 'gru75', 'stgcn']:
            group = [r for r in rows if r['language'] == language and r['architecture'] == architecture]
            values = [r['top1_accuracy'] for r in group]
            lines.append(f"| {language.upper()} | {architecture} | {statistics.mean(values):.1%} ({min(values):.1%}–{max(values):.1%}) | {statistics.mean([r['correct_known_coverage'] for r in group]):.1%} | {' / '.join(str(r['unknown_false_accepts']) for r in group)} of200 each |")
    lines += ['', 'Top-1 is measured before rejection. Accepted coverage includes only correct accepted known examples divided by all known examples. Seed predictions share the same clips and must not be pooled as independent observations. Per-seed known precision, negative-mixture precision, counts and Wilson95 intervals are in the final JSON reports.', '',
        'The full-joint temporal model improves ISL top-1, but strict rejection leaves too little coverage. ASL remains weak. The compact graph candidate is worse than the full-joint GRU in this bounded experiment; this is not a conclusion about all graph models. Every architecture failed the preregistered all-seed validation60% correct-coverage screen, so no winner was selected and none was promoted.', '',
        'Legacy27→full75 changes joint coverage, nearest versus linear resampling, confidence validity and masked coordinate normalization together. Attribute that result to the full feature-contract upgrade. Graph versus full75GRU uses identical feature arrays and statistics. The graph is smaller (12,785ISL /16,100ASL parameters), uses depthwise temporal strides1/2/2, and all3ASL graph runs hit the recorded wall-clock ceiling at epoch boundaries; those constraints limit conclusions.', '',
        '## Evidence', '',
        '- [Frozen protocol](experiment.json), [CPU budget amendment](budget-amendment.json), [pretraining architecture amendment](architecture-amendment.json).',
        '- [ISL selection](isl-selection.json), [ASL selection](asl-selection.json).',
        '- [ISL final benchmark](isl-final.json), [ASL final benchmark](asl-final.json).',
        '- [All18 run metrics](runs.csv), [per-word results](per-word.csv).',
        '- [Real-pose feature parity](../feature-parity-2026-10-04.json): three archived validation poses per language and synthetic edge cases; Python/JS raw and reference-normalized features matched exactly.',
        '- [Trained ONNX/WASM parity and timings](runtime-parity.json): representative seed42GRU75/STGCN per language, three real validation fixtures each; calibrated decisions matched.', '',
        'Single-thread Node WASM classifier timings are operator measurements, not Chrome camera/end-to-end latency. Actual camera, audible speech,20 lifecycle cycles, PWA cache migration, fluent interpretation and Android performance remain unverified. The optional ASL signer study is prepared separately and untrained; it does not change these historical results.', '',
        'Weights, raw poses, validation fixture arrays and prepared data remain in ignored local research directories. Public builds exclude all /models artifacts; the standalone server refuses the entire path. No Gemini call is part of graph recognition.']
    (directory / 'README.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({'runs': len(rows), 'word_rows': len(word_rows), 'total_training_seconds': sum(r['training_seconds'] for r in rows), 'promoted': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--report-dir', type=Path, required=True)
    summarize(parser.parse_args().report_dir)
