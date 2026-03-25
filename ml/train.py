from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader
from tqdm import tqdm

from ml.dataset import ReactionDataset, collate_reaction_batch
from ml.model import ReactionBaselineModel


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a baseline prediction_emotion model.")
    parser.add_argument("--data-root", type=Path, required=True, help="Competition data root.")
    parser.add_argument("--train-split", default="train")
    parser.add_argument("--val-split", default="val")
    parser.add_argument("--train-manifest", type=Path, default=None)
    parser.add_argument("--val-manifest", type=Path, default=None)
    parser.add_argument("--sequence-length", type=int, default=750)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--hidden-dim", type=int, default=128)
    parser.add_argument("--latent-dim", type=int, default=32)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--train-candidates", type=int, default=3)
    parser.add_argument("--eval-candidates", type=int, default=10)
    parser.add_argument("--ccc-weight", type=float, default=0.5)
    parser.add_argument("--diversity-weight", type=float, default=0.02)
    parser.add_argument("--min-diversity", type=float, default=0.01)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/baseline"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    train_dataset = ReactionDataset(
        data_root=args.data_root,
        split=args.train_split,
        manifest_path=args.train_manifest,
        sequence_length=args.sequence_length,
    )
    val_dataset = ReactionDataset(
        data_root=args.data_root,
        split=args.val_split,
        manifest_path=args.val_manifest,
        sequence_length=args.sequence_length,
    )

    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        collate_fn=collate_reaction_batch,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        collate_fn=collate_reaction_batch,
    )

    model = ReactionBaselineModel(
        input_dim=train_dataset.input_dim,
        output_dim=25,
        hidden_dim=args.hidden_dim,
        latent_dim=args.latent_dim,
        dropout=args.dropout,
    ).to(args.device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    best_val = float("inf")
    history: list[dict[str, float]] = []

    for epoch in range(1, args.epochs + 1):
        train_loss = run_epoch(
            model=model,
            loader=train_loader,
            optimizer=optimizer,
            device=args.device,
            candidate_count=args.train_candidates,
            ccc_weight=args.ccc_weight,
            diversity_weight=args.diversity_weight,
            min_diversity=args.min_diversity,
            train=True,
        )
        val_loss = run_epoch(
            model=model,
            loader=val_loader,
            optimizer=None,
            device=args.device,
            candidate_count=args.eval_candidates,
            ccc_weight=args.ccc_weight,
            diversity_weight=0.0,
            min_diversity=args.min_diversity,
            train=False,
        )

        history.append({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss})
        checkpoint = {
            "model_state": model.state_dict(),
            "model_config": {
                "input_dim": train_dataset.input_dim,
                "output_dim": 25,
                "hidden_dim": args.hidden_dim,
                "latent_dim": args.latent_dim,
                "dropout": args.dropout,
            },
            "train_args": make_json_safe(vars(args)),
            "history": history,
        }

        last_path = args.output_dir / "last.pt"
        torch.save(checkpoint, last_path)
        if val_loss < best_val:
            best_val = val_loss
            torch.save(checkpoint, args.output_dir / "best.pt")

        print(
            f"epoch={epoch:03d} "
            f"train_loss={train_loss:.6f} "
            f"val_loss={val_loss:.6f} "
            f"best_val={best_val:.6f}"
        )

    history_path = args.output_dir / "history.json"
    history_path.write_text(json.dumps(history, indent=2), encoding="utf-8")


def run_epoch(
    model: ReactionBaselineModel,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer | None,
    device: str,
    candidate_count: int,
    ccc_weight: float,
    diversity_weight: float,
    min_diversity: float,
    train: bool,
) -> float:
    model.train(train)
    total_loss = 0.0
    total_items = 0
    iterator = tqdm(loader, leave=False, desc="train" if train else "val")

    for batch in iterator:
        inputs = batch["input"].to(device)
        targets = batch["target"].to(device)

        with torch.set_grad_enabled(train):
            predictions = model(inputs, num_candidates=candidate_count)
            loss, stats = best_of_k_loss(
                predictions,
                targets,
                ccc_weight=ccc_weight,
                diversity_weight=diversity_weight,
                min_diversity=min_diversity,
            )
            if train and optimizer is not None:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()

        batch_size = inputs.shape[0]
        total_loss += float(loss.item()) * batch_size
        total_items += batch_size
        iterator.set_postfix(loss=f"{loss.item():.4f}", best=f"{stats['best_loss']:.4f}")

    return total_loss / max(total_items, 1)


def best_of_k_loss(
    predictions: torch.Tensor,
    targets: torch.Tensor,
    ccc_weight: float,
    diversity_weight: float,
    min_diversity: float,
) -> tuple[torch.Tensor, dict[str, float]]:
    targets_expanded = targets.unsqueeze(1)
    mse = torch.mean((predictions - targets_expanded) ** 2, dim=(2, 3))
    ccc_loss = 1.0 - batch_ccc(predictions, targets_expanded)
    combined = mse + (ccc_weight * ccc_loss)
    best_per_sample, _ = combined.min(dim=1)
    loss = best_per_sample.mean()

    if predictions.shape[1] > 1 and diversity_weight > 0.0:
        diversity_penalty = torch.relu(min_diversity - candidate_pairwise_distance(predictions))
        loss = loss + (diversity_weight * diversity_penalty)

    return loss, {"best_loss": float(best_per_sample.mean().item())}


def batch_ccc(predictions: torch.Tensor, targets: torch.Tensor, eps: float = 1e-8) -> torch.Tensor:
    predictions = predictions.flatten(start_dim=2)
    targets = targets.flatten(start_dim=2)
    pred_mean = predictions.mean(dim=2)
    target_mean = targets.mean(dim=2)
    pred_var = predictions.var(dim=2, unbiased=False)
    target_var = targets.var(dim=2, unbiased=False)
    covariance = ((predictions - pred_mean.unsqueeze(-1)) * (targets - target_mean.unsqueeze(-1))).mean(dim=2)
    ccc = (2.0 * covariance) / (pred_var + target_var + (pred_mean - target_mean) ** 2 + eps)
    return ccc


def candidate_pairwise_distance(predictions: torch.Tensor) -> torch.Tensor:
    flat = predictions.flatten(start_dim=2)
    pairwise = torch.cdist(flat, flat, p=2)
    candidate_count = predictions.shape[1]
    if candidate_count < 2:
        return torch.tensor(0.0, device=predictions.device, dtype=predictions.dtype)
    mask = ~torch.eye(candidate_count, device=predictions.device, dtype=torch.bool)
    return pairwise[:, mask].mean()


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def make_json_safe(value):
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {key: make_json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [make_json_safe(item) for item in value]
    return value


if __name__ == "__main__":
    main()
