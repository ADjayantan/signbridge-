"""Publish aggregate frozen-study metrics; never run inference or expose pose IDs."""
import argparse
import csv
import json
from pathlib import Path

from freeze_graph_experiment import sha256


def summarize(selection_path, final_path, output):
    selection = json.loads(selection_path.read_text(encoding='utf-8'))
    final = json.loads(final_path.read_text(encoding='utf-8'))
    if final['frozen_selection_sha256'] != sha256(selection_path):
        raise ValueError('Final report does not match frozen selection')
    output.mkdir(parents=True, exist_ok=True)
    paths = [output / 'runs.csv', output / 'per-word.csv']
    if any(path.exists() for path in paths):
        raise FileExistsError('Aggregate tables already exist; use a new output directory')
    validation = {(row['architecture'], row['seed']): row for row in selection['runs']}
    rows, words = [], []
    for run in final['runs']:
        trained = validation[(run['architecture'], run['seed'])]
        row = {'architecture': run['architecture'], 'seed': run['seed'],
               'epochs': trained['epochs'], 'training_seconds': trained['training_seconds'],
               'parameters': trained['parameters'], 'threshold': run['threshold'], 'margin': run['margin'],
               'offline_acceptance_enabled': run['acceptance_enabled'], 'test_screen_passed': run['test_screen_passed']}
        row.update({key: value for key, value in run['metrics'].items() if not isinstance(value, (dict, list))})
        rows.append(row)
        words.extend({'architecture': run['architecture'], 'seed': run['seed'], **value} for value in run['per_word'])
    for path, table in zip(paths, (rows, words)):
        with path.open('x', encoding='utf-8', newline='') as target:
            writer = csv.DictWriter(target, fieldnames=list(table[0]))
            writer.writeheader()
            writer.writerows(table)
    print(json.dumps({'run_rows': len(rows), 'word_rows': len(words), 'final_report_sha256': sha256(final_path)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection', type=Path, required=True)
    parser.add_argument('--final', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    summarize(args.selection, args.final, args.output)
