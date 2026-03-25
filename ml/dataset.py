from __future__ import annotations

import json
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from torch.utils.data import Dataset


EMOTION_DIM = 25
FACE_DIM = 58
AUDIO_FEATURE_DIM = 4


@dataclass
class SampleRecord:
    sample_id: str
    split: str
    emotion_path: Path
    audio_path: Path | None = None
    face_path: Path | None = None
    match_strategy: str = "manifest"


class ReactionDataset(Dataset):
    """Competition baseline dataset.

    Preferred usage is to pass an explicit manifest so speaker/listener pairs are
    defined by you. When no manifest is provided, the loader falls back to a
    best-effort directory scan and path similarity matching.
    """

    def __init__(
        self,
        data_root: str | Path,
        split: str,
        manifest_path: str | Path | None = None,
        sequence_length: int = 750,
        include_audio: bool = True,
        include_face: bool = True,
    ) -> None:
        self.data_root = Path(data_root)
        self.split = split
        self.sequence_length = sequence_length
        self.include_audio = include_audio
        self.include_face = include_face
        self.records = discover_samples(self.data_root, split, manifest_path)
        if not self.records:
            raise FileNotFoundError(
                f"No usable samples were found for split '{split}'. "
                "Provide the official dataset under data_root or pass a manifest."
            )

        self.audio_dim = AUDIO_FEATURE_DIM if include_audio else 0
        self.face_dim = FACE_DIM if include_face else 0
        self.input_dim = self.audio_dim + self.face_dim
        if self.input_dim == 0:
            raise ValueError("At least one input modality must be enabled.")

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> dict[str, torch.Tensor | str]:
        record = self.records[index]
        target = load_emotion_csv(record.emotion_path)
        target = resample_sequence(target, self.sequence_length)

        features: list[np.ndarray] = []
        if self.include_audio:
            audio_features = load_audio_features(record.audio_path, self.sequence_length)
            features.append(audio_features)
        if self.include_face:
            face_features = load_face_features(record.face_path, self.sequence_length)
            features.append(face_features)

        model_input = np.concatenate(features, axis=1).astype(np.float32)

        return {
            "input": torch.from_numpy(model_input),
            "target": torch.from_numpy(target.astype(np.float32)),
            "sample_id": record.sample_id,
        }


def collate_reaction_batch(batch: list[dict[str, torch.Tensor | str]]) -> dict[str, torch.Tensor | list[str]]:
    inputs = torch.stack([item["input"] for item in batch])
    targets = torch.stack([item["target"] for item in batch])
    sample_ids = [str(item["sample_id"]) for item in batch]
    return {
        "input": inputs,
        "target": targets,
        "sample_id": sample_ids,
    }


def discover_samples(
    data_root: str | Path,
    split: str,
    manifest_path: str | Path | None = None,
) -> list[SampleRecord]:
    root = Path(data_root)
    if manifest_path:
        return load_manifest(root, split, Path(manifest_path))
    return auto_discover_samples(root, split)


def load_manifest(data_root: Path, split: str, manifest_path: Path) -> list[SampleRecord]:
    payload = read_manifest_payload(manifest_path)
    records: list[SampleRecord] = []
    for index, item in enumerate(payload):
        item_split = item.get("split", split)
        if item_split != split:
            continue
        emotion_path = resolve_data_path(data_root, item["emotion_path"])
        audio_path = resolve_data_path(data_root, item["audio_path"]) if item.get("audio_path") else None
        face_path = resolve_data_path(data_root, item["face_path"]) if item.get("face_path") else None
        sample_id = item.get("sample_id") or f"{split}-{index:06d}"
        records.append(
            SampleRecord(
                sample_id=sample_id,
                split=item_split,
                emotion_path=emotion_path,
                audio_path=audio_path,
                face_path=face_path,
                match_strategy="manifest",
            )
        )
    return records


def read_manifest_payload(manifest_path: Path) -> list[dict]:
    text = manifest_path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if manifest_path.suffix.lower() == ".jsonl":
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    payload = json.loads(text)
    if isinstance(payload, dict):
        return payload.get("samples", [])
    if isinstance(payload, list):
        return payload
    raise ValueError(f"Unsupported manifest format: {manifest_path}")


def auto_discover_samples(data_root: Path, split: str) -> list[SampleRecord]:
    split_root = data_root / split
    emotion_root = split_root / "Emotion"
    audio_root = split_root / "Audio_files"
    face_root = split_root / "3D_FV_files"
    if not emotion_root.exists():
        raise FileNotFoundError(f"Missing Emotion directory: {emotion_root}")

    emotion_files = sorted(emotion_root.rglob("*.csv"))
    audio_index = build_candidate_index(scan_files(audio_root, [".wav", ".mp3", ".flac"]))
    face_index = build_candidate_index(scan_files(face_root, [".npy"]))

    records: list[SampleRecord] = []
    for emotion_path in emotion_files:
        relative = emotion_path.relative_to(emotion_root)
        key_tokens = normalize_path_tokens(relative.with_suffix(""))
        audio_path = find_best_candidate(relative, audio_index)
        face_path = find_best_candidate(relative, face_index)
        sample_id = "__".join(key_tokens) or relative.stem
        records.append(
            SampleRecord(
                sample_id=sample_id,
                split=split,
                emotion_path=emotion_path,
                audio_path=audio_path,
                face_path=face_path,
                match_strategy="auto",
            )
        )
    return records


def scan_files(root: Path, suffixes: Iterable[str]) -> list[Path]:
    if not root.exists():
        return []
    lowered = {suffix.lower() for suffix in suffixes}
    return [path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in lowered]


def build_candidate_index(paths: Iterable[Path]) -> dict[str, list[Path]]:
    index: dict[str, list[Path]] = {}
    for path in paths:
        index.setdefault(path.stem.lower(), []).append(path)
    return index


def find_best_candidate(relative_emotion_path: Path, index: dict[str, list[Path]]) -> Path | None:
    candidates = index.get(relative_emotion_path.stem.lower(), [])
    if not candidates:
        return None
    emotion_tokens = normalize_path_tokens(relative_emotion_path.with_suffix(""))

    def score(candidate: Path) -> tuple[int, int]:
        candidate_tokens = normalize_path_tokens(candidate.with_suffix(""))
        overlap = len(set(emotion_tokens) & set(candidate_tokens))
        suffix_overlap = common_suffix_length(emotion_tokens, candidate_tokens)
        return overlap, suffix_overlap

    return max(candidates, key=score)


def normalize_path_tokens(path: Path) -> list[str]:
    skip = {
        "emotion",
        "audio_files",
        "3d_fv_files",
        "expert_video",
        "novice_video",
        "p1",
        "p2",
        "train",
        "val",
    }
    tokens = []
    for part in path.parts:
        normalized = part.replace("\\", "/").lower().strip()
        if normalized and normalized not in skip:
            tokens.append(normalized)
    return tokens


def common_suffix_length(a: list[str], b: list[str]) -> int:
    count = 0
    for left, right in zip(reversed(a), reversed(b)):
        if left != right:
            break
        count += 1
    return count


def resolve_data_path(data_root: Path, value: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate
    return data_root / candidate


def load_emotion_csv(path: Path) -> np.ndarray:
    array = np.genfromtxt(path, delimiter=",", dtype=np.float32)
    if array.ndim == 1:
        array = array[None, :]
    array = drop_nan_rows(array)
    if array.shape[1] < EMOTION_DIM:
        raise ValueError(f"Emotion file has {array.shape[1]} columns, expected at least {EMOTION_DIM}: {path}")
    if array.shape[1] > EMOTION_DIM:
        array = array[:, -EMOTION_DIM:]
    return np.nan_to_num(array, nan=0.0)


def load_face_features(path: Path | None, target_length: int) -> np.ndarray:
    if path is None or not path.exists():
        return np.zeros((target_length, FACE_DIM), dtype=np.float32)
    array = np.load(path)
    array = np.asarray(array, dtype=np.float32)
    if array.ndim == 1:
        array = array[:, None]
    if array.shape[1] < FACE_DIM:
        pad = np.zeros((array.shape[0], FACE_DIM - array.shape[1]), dtype=np.float32)
        array = np.concatenate([array, pad], axis=1)
    elif array.shape[1] > FACE_DIM:
        array = array[:, :FACE_DIM]
    return resample_sequence(array, target_length)


def load_audio_features(path: Path | None, target_length: int) -> np.ndarray:
    if path is None or not path.exists():
        return np.zeros((target_length, AUDIO_FEATURE_DIM), dtype=np.float32)

    samples, _ = read_wav_mono(path)
    if samples.size == 0:
        return np.zeros((target_length, AUDIO_FEATURE_DIM), dtype=np.float32)

    frame_edges = np.linspace(0, samples.shape[0], num=target_length + 1, dtype=np.int64)
    features = np.zeros((target_length, AUDIO_FEATURE_DIM), dtype=np.float32)
    for frame_index in range(target_length):
        start = int(frame_edges[frame_index])
        end = int(frame_edges[frame_index + 1])
        frame = samples[start:end]
        if frame.size == 0:
            continue
        mean_abs = float(np.mean(np.abs(frame)))
        std = float(np.std(frame))
        peak = float(np.max(np.abs(frame)))
        zcr = float(np.mean(frame[:-1] * frame[1:] < 0)) if frame.size > 1 else 0.0
        features[frame_index] = np.array([mean_abs, std, peak, zcr], dtype=np.float32)
    return features


def read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        sample_rate = handle.getframerate()
        frame_count = handle.getnframes()
        raw = handle.readframes(frame_count)

    dtype = {1: np.int8, 2: np.int16, 4: np.int32}.get(sample_width)
    if dtype is None:
        raise ValueError(f"Unsupported audio sample width {sample_width} for {path}")

    array = np.frombuffer(raw, dtype=dtype).astype(np.float32)
    if channels > 1:
        array = array.reshape(-1, channels).mean(axis=1)
    scale = float(np.iinfo(dtype).max or 1)
    array = np.clip(array / scale, -1.0, 1.0)
    return array, sample_rate


def resample_sequence(sequence: np.ndarray, target_length: int) -> np.ndarray:
    sequence = np.asarray(sequence, dtype=np.float32)
    if sequence.ndim == 1:
        sequence = sequence[:, None]
    current_length = sequence.shape[0]
    if current_length == target_length:
        return sequence.astype(np.float32)
    if current_length <= 1:
        return np.repeat(sequence[:1], target_length, axis=0).astype(np.float32)

    source_positions = np.linspace(0.0, 1.0, num=current_length, dtype=np.float32)
    target_positions = np.linspace(0.0, 1.0, num=target_length, dtype=np.float32)
    output = np.zeros((target_length, sequence.shape[1]), dtype=np.float32)
    for dim in range(sequence.shape[1]):
        output[:, dim] = np.interp(target_positions, source_positions, sequence[:, dim])
    return output


def drop_nan_rows(array: np.ndarray) -> np.ndarray:
    if not np.isnan(array).any():
        return array
    mask = ~np.all(np.isnan(array), axis=1)
    filtered = array[mask]
    return filtered if filtered.size else np.zeros((1, array.shape[1]), dtype=np.float32)

