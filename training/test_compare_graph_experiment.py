import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from compare_graph_experiment import ARCHITECTURES, SEEDS, freeze_selection
from freeze_graph_experiment import sha256


class SelectionTests(unittest.TestCase):
    def make_runs(self, root, fail_seed=None):
        legacy = root / 'legacy.npz'
        legacy.write_bytes(b'synthetic legacy provenance fixture')
        experiment = {'signLanguage': 'isl', 'dataSha256': '0' * 64, 'legacyDataSha256': sha256(legacy)}
        (root / 'experiment.json').write_text(json.dumps(experiment), encoding='utf-8')
        targets = np.arange(20, dtype=np.int64) % 2
        correct = np.array([[.999, .001] if y == 0 else [.001, .999] for y in targets])
        for architecture in ARCHITECTURES:
            for seed in SEEDS:
                folder = root / f'{architecture}-seed{seed}'
                folder.mkdir()
                (folder / 'checkpoint.pt').write_bytes(b'local synthetic hash fixture')
                scores = correct.copy()
                if architecture == 'gru27': scores[-5:] = [.5, .5]
                if architecture != 'gru27' and seed == fail_seed: scores[:] = [.5, .5]
                np.savez(folder / 'validation-predictions.npz', scores=scores, targets=targets, unknown_scores=np.tile([.5, .5], (20, 1)))
                run = {'signLanguage': 'isl', 'architecture': architecture, 'seed': seed, 'weightsSha256': sha256(folder / 'checkpoint.pt'), 'checkpoint': str(folder / 'checkpoint.pt'), 'experimentSha256': sha256(root / 'experiment.json'), 'dataSha256': '0' * 64, 'budget': {'epochs': 80}, 'bestValidationMacroRecall': .9, 'epochsRun': 80, 'trainingSeconds': 10, 'parameters': 5000, 'stopReason': 'epoch-ceiling'}
                (folder / 'run.json').write_text(json.dumps(run), encoding='utf-8')

    def test_requires_all_seeds_and_uses_fixed_representative(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.make_runs(root)
            result = freeze_selection(root, root / 'selection.json', root / 'legacy.npz')
            self.assertEqual(result['selected_architecture'], 'gru75')
            self.assertEqual(result['representative_seed'], 42)
            self.assertFalse(result['promotion'])
            with self.assertRaises(FileExistsError): freeze_selection(root, root / 'selection.json', root / 'legacy.npz')

    def test_one_failing_seed_blocks_architecture_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.make_runs(root, fail_seed=44)
            result = freeze_selection(root, root / 'selection.json', root / 'legacy.npz')
            self.assertIsNone(result['selected_architecture'])

    def test_changed_weights_rejected_before_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.make_runs(root)
            (root / 'gru27-seed42' / 'checkpoint.pt').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'Checkpoint changed'): freeze_selection(root, root / 'selection.json', root / 'legacy.npz')

    def test_changed_legacy_inputs_and_mixed_budgets_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.make_runs(root)
            (root / 'legacy.npz').write_bytes(b'replaced')
            with self.assertRaisesRegex(ValueError, 'Legacy prepared data changed'): freeze_selection(root, root / 'selection.json', root / 'legacy.npz')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.make_runs(root)
            path = root / 'gru75-seed42' / 'run.json'
            run = json.loads(path.read_text()); run['budget']['epochs'] = 160; path.write_text(json.dumps(run))
            with self.assertRaisesRegex(ValueError, 'different optimization budgets'): freeze_selection(root, root / 'selection.json', root / 'legacy.npz')


if __name__ == '__main__': unittest.main()
