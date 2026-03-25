from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.metrics import frcorr, frdist, frdiv, frdvs, frsyn, frvar, load_neighbors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate exported prediction_emotion arrays.")
    parser.add_argument("--prediction-file", type=Path, required=True)
    parser.add_argument("--target-file", type=Path, required=True)
    parser.add_argument("--speaker-file", type=Path, default=None)
    parser.add_argument("--sample-ids", type=Path, default=None)
    parser.add_argument("--neighbor-file", type=Path, default=None)
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--dtw-stride", type=int, default=1)
    parser.add_argument("--output-file", type=Path, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    predictions = np.load(args.prediction_file)
    references = np.load(args.target_file)
    sample_ids = None
    neighbors = None

    if args.sample_ids and args.sample_ids.exists():
        sample_ids = json.loads(args.sample_ids.read_text(encoding="utf-8"))

    if args.neighbor_file:
        neighbors = load_neighbors(args.neighbor_file, sample_ids=sample_ids)

    results = {
        "FRCorr": frcorr(predictions, references, neighbors=neighbors),
        "FRdist": frdist(predictions, references, neighbors=neighbors, dtw_stride=args.dtw_stride),
        "FRDiv": frdiv(predictions),
        "FRDvs": frdvs(predictions),
        "FRVar": frvar(predictions),
    }

    if args.speaker_file:
        speaker_features = np.load(args.speaker_file)
        results["FRSyn"] = frsyn(predictions, speaker_features, fps=args.fps)

    text = json.dumps(results, indent=2)
    if args.output_file:
        args.output_file.parent.mkdir(parents=True, exist_ok=True)
        args.output_file.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
