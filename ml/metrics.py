from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import numpy as np


def concordance_ccc(left: np.ndarray, right: np.ndarray, eps: float = 1e-8) -> float:
    left = np.asarray(left, dtype=np.float64).reshape(-1)
    right = np.asarray(right, dtype=np.float64).reshape(-1)
    if left.size != right.size:
        raise ValueError(f"Shape mismatch for CCC: {left.shape} vs {right.shape}")

    left_mean = left.mean()
    right_mean = right.mean()
    left_var = left.var()
    right_var = right.var()
    covariance = ((left - left_mean) * (right - right_mean)).mean()
    return float((2.0 * covariance) / (left_var + right_var + (left_mean - right_mean) ** 2 + eps))


def frcorr(predictions: np.ndarray, references: np.ndarray, neighbors: Iterable[Iterable[int]] | None = None) -> float:
    predictions = np.asarray(predictions)
    references = np.asarray(references)
    total = 0.0
    normalized_neighbors = normalize_neighbors(predictions.shape[0], neighbors)
    for sample_index, candidate_neighbors in enumerate(normalized_neighbors):
        for candidate_index in range(predictions.shape[1]):
            candidate = predictions[sample_index, candidate_index]
            best = max(
                concordance_ccc(candidate, references[reference_index])
                for reference_index in candidate_neighbors
            )
            total += best
    return total / predictions.shape[0]


def frdist(
    predictions: np.ndarray,
    references: np.ndarray,
    neighbors: Iterable[Iterable[int]] | None = None,
    dtw_stride: int = 1,
) -> float:
    predictions = np.asarray(predictions)
    references = np.asarray(references)
    total = 0.0
    normalized_neighbors = normalize_neighbors(predictions.shape[0], neighbors)
    for sample_index, candidate_neighbors in enumerate(normalized_neighbors):
        for candidate_index in range(predictions.shape[1]):
            candidate = predictions[sample_index, candidate_index]
            best = min(
                weighted_dtw_distance(candidate, references[reference_index], stride=dtw_stride)
                for reference_index in candidate_neighbors
            )
            total += best
    return total / predictions.shape[0]


def frdiv(predictions: np.ndarray) -> float:
    predictions = np.asarray(predictions)
    batch_size, num_candidates, _, _ = predictions.shape
    flat = predictions.reshape(batch_size, num_candidates, -1)
    feature_dim = flat.shape[-1]
    if num_candidates < 2:
        return 0.0

    per_sample = []
    for sample_index in range(batch_size):
        total = 0.0
        for left in range(num_candidates):
            for right in range(num_candidates):
                if left == right:
                    continue
                diff = flat[sample_index, left] - flat[sample_index, right]
                total += float(np.dot(diff, diff))
        per_sample.append(total / (num_candidates * (num_candidates - 1) * feature_dim))
    return float(np.mean(per_sample))


def frdvs(predictions: np.ndarray) -> float:
    predictions = np.asarray(predictions)
    batch_size, num_candidates, _, _ = predictions.shape
    if batch_size < 2:
        return 0.0
    flat = predictions.reshape(batch_size, num_candidates, -1)
    feature_dim = flat.shape[-1]

    total = 0.0
    for candidate_index in range(num_candidates):
        for left in range(batch_size):
            for right in range(batch_size):
                if left == right:
                    continue
                diff = flat[left, candidate_index] - flat[right, candidate_index]
                total += float(np.dot(diff, diff))
    return total / (batch_size * (batch_size - 1) * num_candidates * feature_dim)


def frvar(predictions: np.ndarray) -> float:
    predictions = np.asarray(predictions)
    variance = np.var(predictions, axis=2)
    return float(np.mean(variance))


def frsyn(predictions: np.ndarray, speakers: np.ndarray, fps: int = 25) -> float:
    predictions = np.asarray(predictions)
    speakers = np.asarray(speakers)
    if predictions.shape[0] != speakers.shape[0]:
        raise ValueError("Predictions and speakers must have the same sample count.")

    max_lag = (2 * fps) - 1
    offsets = []
    for sample_index in range(predictions.shape[0]):
        speaker_series = speakers[sample_index].mean(axis=1)
        for candidate_index in range(predictions.shape[1]):
            candidate_series = predictions[sample_index, candidate_index].mean(axis=1)
            offsets.append(abs(best_correlation_lag(candidate_series, speaker_series, max_lag)))
    return float(np.mean(offsets)) if offsets else 0.0


def frrea_from_dirs(fake_dir: str | Path, real_dir: str | Path) -> float:
    try:
        from pytorch_fid.fid_score import calculate_fid_given_paths
    except ImportError as error:
        raise ImportError(
            "pytorch-fid is required for FRRea. Install it from ml/requirements.txt."
        ) from error

    fake_dir = str(fake_dir)
    real_dir = str(real_dir)
    return float(calculate_fid_given_paths([fake_dir, real_dir], batch_size=32, device="cpu", dims=2048))


def weighted_dtw_distance(left: np.ndarray, right: np.ndarray, stride: int = 1) -> float:
    left = np.asarray(left, dtype=np.float64)
    right = np.asarray(right, dtype=np.float64)
    if stride > 1:
        left = left[::stride]
        right = right[::stride]
    return (
        (1.0 / 15.0) * dtw_distance(left[:, 0:15], right[:, 0:15])
        + dtw_distance(left[:, 15:17], right[:, 15:17])
        + (1.0 / 8.0) * dtw_distance(left[:, 17:25], right[:, 17:25])
    )


def dtw_distance(left: np.ndarray, right: np.ndarray) -> float:
    left = np.asarray(left, dtype=np.float64)
    right = np.asarray(right, dtype=np.float64)
    rows, cols = left.shape[0], right.shape[0]
    dp = np.full((rows + 1, cols + 1), np.inf, dtype=np.float64)
    dp[0, 0] = 0.0

    for row in range(1, rows + 1):
        for col in range(1, cols + 1):
            cost = np.linalg.norm(left[row - 1] - right[col - 1])
            dp[row, col] = cost + min(dp[row - 1, col], dp[row, col - 1], dp[row - 1, col - 1])
    return float(dp[rows, cols])


def best_correlation_lag(left: np.ndarray, right: np.ndarray, max_lag: int) -> int:
    left = np.asarray(left, dtype=np.float64)
    right = np.asarray(right, dtype=np.float64)
    best_lag = 0
    best_score = -np.inf
    for lag in range(-max_lag, max_lag + 1):
        if lag < 0:
            score = correlation_score(left[:lag], right[-lag:])
        elif lag > 0:
            score = correlation_score(left[lag:], right[:-lag])
        else:
            score = correlation_score(left, right)
        if score > best_score:
            best_score = score
            best_lag = lag
    return best_lag


def correlation_score(left: np.ndarray, right: np.ndarray) -> float:
    if left.size == 0 or right.size == 0:
        return -np.inf
    left_std = left.std()
    right_std = right.std()
    if left_std == 0.0 or right_std == 0.0:
        return -np.inf
    return float(np.corrcoef(left, right)[0, 1])


def normalize_neighbors(sample_count: int, neighbors: Iterable[Iterable[int]] | None) -> list[list[int]]:
    if neighbors is None:
        return [[index] for index in range(sample_count)]
    normalized = [list(group) for group in neighbors]
    if len(normalized) != sample_count:
        raise ValueError("Neighbor list length must match the number of samples.")
    return normalized


def load_neighbors(path: str | Path, sample_ids: list[str] | None = None) -> list[list[int]]:
    path = Path(path)
    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            if sample_ids is None:
                raise ValueError("sample_ids are required when neighbors are stored as a dict.")
            index_by_id = {sample_id: idx for idx, sample_id in enumerate(sample_ids)}
            return [
                [index_by_id[item] for item in payload.get(sample_id, [sample_id]) if item in index_by_id]
                for sample_id in sample_ids
            ]
        return [list(group) for group in payload]

    array = np.load(path, allow_pickle=True)
    if array.dtype == object:
        return [list(group) for group in array.tolist()]
    if array.ndim == 2 and array.dtype == bool:
        return [np.flatnonzero(row).tolist() for row in array]
    if array.ndim == 2:
        return [row.astype(int).tolist() for row in array]
    raise ValueError(f"Unsupported neighbor format: {path}")
