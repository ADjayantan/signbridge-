"""Preregistration must not consume test features or silently replace a protocol."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from freeze_signer_experiment import freeze
from freeze_graph_experiment import sha256
from prepare_signer_study import prepare_study, record_strict_protocol
from test_prepare_signer_study import sources


def fixture(root):
    graph, legacy, _, _ = sources(root, strict_pool=True)
    protocol = root / 'negative-protocol.json'
    record_strict_protocol(graph, legacy, protocol)
    prepared = root / 'study'
    report = prepare_study(graph, legacy, prepared, strict_negatives=True, protocol_path=protocol)
    inventory = root / 'inventory.json'
    inventory.write_text(json.dumps(report), encoding='utf-8')
    return prepared / 'asl.npz', prepared / 'asl-legacy.npz', protocol, inventory


class TestSignerPreregistration(unittest.TestCase):
    def test_freeze_hashes_matched_sources_without_reading_final_features_or_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = fixture(root)
            original_load = np.load

            class MetadataOnlyFinal:
                def __init__(self, path, **kwargs):
                    self.value = original_load(path, **kwargs)
                def __enter__(self):
                    return self
                def __exit__(self, *unused):
                    self.value.close()
                def __getitem__(self, key):
                    if key in ('X_test', 'y_test', 'X_unknown_test', 'y_unknown_test'):
                        raise AssertionError('Final feature/target read before freeze')
                    return self.value[key]

            output = root / 'experiment.json'
            with patch('numpy.load', side_effect=lambda path, **kwargs: MetadataOnlyFinal(path, **kwargs)):
                result = freeze(*args, output)
            self.assertEqual(result['models'], ['gru27', 'gru75'])
            self.assertEqual(result['seeds'], [42, 43, 44])
            self.assertEqual(result['dataSha256'], sha256(args[0]))
            self.assertEqual(result['inventorySha256'], sha256(args[3]))
            self.assertFalse(result['trained'])
            self.assertFalse(result['testPredictionsPerformed'])
            self.assertFalse(result['promoted'])
            self.assertEqual(result['training']['maxSeconds'], 1200)

    def test_existing_protocol_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = fixture(root)
            output = root / 'experiment.json'
            freeze(*args, output)
            before = output.read_bytes()
            with self.assertRaises(FileExistsError):
                freeze(*args, output)
            self.assertEqual(output.read_bytes(), before)

    def test_changed_data_or_non_strict_inventory_cannot_be_frozen(self):
        for change in ('data', 'strict'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                args = fixture(root)
                if change == 'data':
                    with args[0].open('ab') as source:
                        source.write(b'changed')
                else:
                    report = json.loads(args[3].read_text())
                    report['strictNegatives'] = False
                    args[3].write_text(json.dumps(report))
                with self.assertRaises(ValueError):
                    freeze(*args, root / 'experiment.json')
                self.assertFalse((root / 'experiment.json').exists())

    def test_report_claim_cannot_hide_actual_signer_leakage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph, legacy, protocol, inventory = fixture(root)
            for path in (graph, legacy):
                with np.load(path, allow_pickle=False) as source:
                    data = {key: source[key] for key in source.files}
                data['signer_ids_test'][0] = data['signer_ids_train'][0]
                np.savez_compressed(path, **data)
            report = json.loads(inventory.read_text())
            report['dataHashes'] = {'graph': sha256(graph), 'legacy': sha256(legacy)}
            inventory.write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'Signer leakage'):
                freeze(graph, legacy, protocol, inventory, root / 'experiment.json')


if __name__ == '__main__':
    unittest.main()
