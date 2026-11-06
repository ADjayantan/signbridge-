"""Small exportable research models; confidence masking is part of the model.

The full-joint candidates consume raw signbridge-pose75-xyc-v1 features.
Their training-only XY standardization is embedded for browser parity. The
legacy GRU27 control retains its separately declared historical preprocessing.
"""
from __future__ import annotations

import numpy as np
import torch
from torch import nn

ARCHITECTURES = ("gru27", "gru75", "stgcn")
# Keep the historical registry unchanged: frozen comparisons import it.
EXPERIMENTAL_ARCHITECTURES = ("lstm75",)
TEMPORAL_CONTROL_ARCHITECTURES = ("gru75", "lstm75")
LSTM75_CONFIG = {"inputSize": 225, "hiddenSize": 64, "layers": 1,
                 "bidirectional": False, "headDropout": .15}
GRAPH_CONFIG = {"widths": [32, 64, 64], "temporalKernel": 5,
                "temporalStrides": [1, 2, 2], "depthwiseTemporal": True,
                "aggregation": "dense-masked-neighbor-average", "dropout": .15}
LEGACY_PROFILE_GRAPH_CONFIG = {**GRAPH_CONFIG, "temporalStrides": [1, 1, 1], "depthwiseTemporal": False}


def make_adjacency():
    from pose_graph import EDGES
    adjacency = np.eye(75, dtype=np.float32)
    for left, right in EDGES:
        adjacency[left, right] = adjacency[right, left] = 1
    return adjacency


class MaskedGraphBlock(nn.Module):
    """Only observed neighbors contribute; destination nodes stay masked."""
    def __init__(self, channels_in, channels_out, adjacency, dropout=.15, stride=1, depthwise=False):
        super().__init__()
        self.stride = stride
        self.register_buffer("adjacency", torch.as_tensor(adjacency, dtype=torch.float32))
        self.spatial = nn.Linear(channels_in, channels_out)
        self.temporal = nn.Conv2d(channels_out, channels_out, (5, 1), stride=(stride, 1),
            padding=(2, 0), groups=channels_out if depthwise else 1)
        self.residual = nn.Identity() if channels_in == channels_out else nn.Linear(channels_in, channels_out)
        self.dropout = nn.Dropout(dropout)

    def aggregate(self, x, mask):
        valid = mask.unsqueeze(-1)
        total = torch.matmul(self.adjacency, x * valid)
        degree = torch.matmul(self.adjacency, valid).clamp(min=1)
        return (total / degree) * valid

    def forward(self, x, mask):
        valid = mask.unsqueeze(-1)
        spatial = torch.relu(self.spatial(self.aggregate(x, mask))) * valid
        temporal = self.temporal(spatial.permute(0, 3, 1, 2)).permute(0, 2, 3, 1)
        output_valid = valid[:, ::self.stride]
        return self.dropout(torch.relu(temporal + self.residual(x[:, ::self.stride]))) * output_valid


class SignGraphModel(nn.Module):
    def __init__(self, classes, architecture, mean, std, adjacency=None, graph_config=None):
        super().__init__()
        if architecture not in ARCHITECTURES + EXPERIMENTAL_ARCHITECTURES or not 2 <= classes <= 500:
            raise ValueError("Unsupported architecture or invalid classes")
        self.architecture = architecture
        self.classes = classes
        expected = (81,) if architecture == "gru27" else (75, 2)
        mean, std = np.asarray(mean), np.asarray(std)
        if mean.shape != expected or std.shape != expected or not np.isfinite(mean).all() or not np.isfinite(std).all() or np.any(std < .05):
            raise ValueError("Invalid training-only normalization statistics")
        self.register_buffer("mean", torch.as_tensor(mean, dtype=torch.float32))
        self.register_buffer("std", torch.as_tensor(std, dtype=torch.float32))
        self.dropout = nn.Dropout(.15)
        if architecture in ("gru27", "gru75"):
            self.gru = nn.GRU(81 if architecture == "gru27" else 225, 64, batch_first=True)
            self.head = nn.Linear(64, classes)
        elif architecture == "lstm75":
            # Temporal control, not graph convolution. Same masked XY/confidence
            # features and hidden width as GRU75; newly trained weights only.
            self.lstm = nn.LSTM(LSTM75_CONFIG["inputSize"], LSTM75_CONFIG["hiddenSize"],
                                num_layers=LSTM75_CONFIG["layers"], batch_first=True,
                                bidirectional=LSTM75_CONFIG["bidirectional"])
            self.head = nn.Linear(LSTM75_CONFIG["hiddenSize"], classes)
        else:
            if adjacency is None:
                adjacency = make_adjacency()
            self.graph_config = graph_config or GRAPH_CONFIG
            if self.graph_config["widths"] != [32, 64, 64] or self.graph_config["temporalKernel"] != 5 or self.graph_config["temporalStrides"] not in ([1, 1, 1], [1, 2, 2]):
                raise ValueError("Unsupported frozen graph architecture")
            channels = [3, *self.graph_config["widths"]]
            self.blocks = nn.ModuleList([
                MaskedGraphBlock(channels[i], channels[i + 1], adjacency,
                    stride=self.graph_config["temporalStrides"][i], depthwise=self.graph_config["depthwiseTemporal"])
                for i in range(3)
            ])
            self.head = nn.Linear(64, classes)

    def preprocess(self, pose):
        if self.architecture == "gru27":
            return (pose - self.mean) / self.std, None
        mask = (pose[..., 2] >= .5).to(pose.dtype)
        xy = ((pose[..., :2] - self.mean) / self.std) * mask.unsqueeze(-1)
        confidence = pose[..., 2:3].clamp(0, 1) * mask.unsqueeze(-1)
        return torch.cat((xy, confidence), dim=-1), mask

    def forward(self, pose):
        x, mask = self.preprocess(pose)
        if self.architecture in ("gru27", "gru75", "lstm75"):
            if self.architecture != "gru27":
                x = x.reshape(x.shape[0], 32, 225)
            if self.architecture == "lstm75":
                _, (hidden, _cell) = self.lstm(x)
            else:
                _, hidden = self.gru(x)
            embedding = hidden[-1]
        else:
            for block in self.blocks:
                x = block(x, mask)
                mask = mask[:, ::block.stride]
            count = mask.sum(dim=(1, 2)).unsqueeze(-1).clamp(min=1)
            embedding = (x * mask.unsqueeze(-1)).sum(dim=(1, 2)) / count
        return self.head(self.dropout(embedding))


class ProbabilityModel(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, pose):
        return self.model(pose).softmax(-1)


def model_from_run(run, weights):
    normalization = run["normalization"]
    model = SignGraphModel(len(run["labels"]), run["architecture"], normalization["mean"], normalization["std"],
        graph_config=run.get("graphConfig", LEGACY_PROFILE_GRAPH_CONFIG))
    model.load_state_dict(weights, strict=True)
    return model


def load_checkpoint(path):
    """Load only tensor weights; architecture/normalization live in JSON."""
    import hashlib
    import json
    from pathlib import Path
    path = Path(path)
    run = json.loads(path.with_name("run.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != run["weightsSha256"]:
        raise ValueError("Checkpoint hash mismatch")
    weights = torch.load(path, map_location="cpu", weights_only=True)
    model = model_from_run(run, weights)
    model.eval()
    return model, run
