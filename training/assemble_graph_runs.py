"""Assemble immutable completed study runs for one comparison; no training."""
import argparse
from pathlib import Path
import shutil

from freeze_graph_experiment import sha256


def assemble(grus, graphs, output):
    if output.exists():
        raise FileExistsError('Use a new combined study directory')
    sources = []
    for language in ['isl', 'asl']:
        for architecture in ['gru27', 'gru75', 'stgcn']:
            for seed in [42, 43, 44]:
                folder = (graphs if architecture == 'stgcn' else grus) / language / f'{architecture}-seed{seed}'
                for name in ['run.json', 'checkpoint.pt', 'validation-predictions.npz']:
                    if not (folder / name).is_file():
                        raise ValueError(f'Incomplete study run: {language}/{architecture}/seed{seed}')
                sources.append((folder, output / language / folder.name))
    output.mkdir(parents=True, exist_ok=False)
    for source, target in sources:
        shutil.copytree(source, target)
        for name in ['run.json', 'checkpoint.pt', 'validation-predictions.npz']:
            if sha256(source / name) != sha256(target / name):
                raise ValueError('Copy integrity mismatch')
    print(f'Assembled {len(sources)} completed runs; source runs unchanged.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--grus', type=Path, required=True)
    parser.add_argument('--graphs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assemble(args.grus, args.graphs, args.output)
