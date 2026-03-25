from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader
from tqdm import tqdm

from ml.dataset import ReactionDataset, collate_reaction_batch
from ml.model import ReactionBaselineModel


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run baseline inference and export prediction_emotion.")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--split", default="val")
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--sequence-length", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--num-candidates", type=int, default=10)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/infer"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    checkpoint = torch.load(args.checkpoint, map_location=args.device, weights_only=False)
    model_config = checkpoint["model_config"]
    train_args = checkpoint.get("train_args", {})

    dataset = ReactionDataset(
        data_root=args.data_root,
        split=args.split,
        manifest_path=args.manifest,
        sequence_length=args.sequence_length or int(train_args.get("sequence_length", 750)),
    )
    loader = DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        collate_fn=collate_reaction_batch,
    )

    model = ReactionBaselineModel(**model_config).to(args.device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    outputs = []
    targets = []
    inputs = []
    sample_ids: list[str] = []

    with torch.no_grad():
        for batch in tqdm(loader, desc="infer", leave=False):
            batch_inputs = batch["input"].to(args.device)
            predictions = model(batch_inputs, num_candidates=args.num_candidates)
            outputs.append(predictions.cpu().numpy())
            targets.append(batch["target"].numpy())
            inputs.append(batch["input"].numpy())
            sample_ids.extend(batch["sample_id"])

    args.output_dir.mkdir(parents=True, exist_ok=True)
    prediction_emotion = np.concatenate(outputs, axis=0)
    target_emotion = np.concatenate(targets, axis=0)
    source_features = np.concatenate(inputs, axis=0)

    np.save(args.output_dir / "prediction_emotion.npy", prediction_emotion)
    np.save(args.output_dir / "target_emotion.npy", target_emotion)
    np.save(args.output_dir / "source_features.npy", source_features)
    (args.output_dir / "sample_ids.json").write_text(json.dumps(sample_ids, indent=2), encoding="utf-8")

    summary = {
        "prediction_shape": list(prediction_emotion.shape),
        "target_shape": list(target_emotion.shape),
        "input_shape": list(source_features.shape),
        "sample_count": len(sample_ids),
        "num_candidates": args.num_candidates,
    }
    (args.output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
