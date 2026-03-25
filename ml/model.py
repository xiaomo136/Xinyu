from __future__ import annotations

import torch
from torch import nn


class ReactionBaselineModel(nn.Module):
    """Small stochastic baseline that can emit K candidate sequences."""

    def __init__(
        self,
        input_dim: int,
        output_dim: int = 25,
        hidden_dim: int = 128,
        latent_dim: int = 32,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.input_dim = input_dim
        self.output_dim = output_dim
        self.hidden_dim = hidden_dim
        self.latent_dim = latent_dim

        self.encoder = nn.GRU(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=2,
            batch_first=True,
            dropout=dropout,
            bidirectional=True,
        )
        self.context_proj = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
        )
        self.decoder = nn.Sequential(
            nn.Linear(hidden_dim + latent_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, output_dim),
        )

    def forward(
        self,
        inputs: torch.Tensor,
        num_candidates: int = 1,
        noise: torch.Tensor | None = None,
    ) -> torch.Tensor:
        encoded, _ = self.encoder(inputs)
        context = self.context_proj(encoded)

        batch_size, seq_len, _ = context.shape
        if noise is None:
            noise = torch.randn(
                batch_size,
                num_candidates,
                self.latent_dim,
                device=inputs.device,
                dtype=inputs.dtype,
            )

        context = context.unsqueeze(1).expand(batch_size, num_candidates, seq_len, self.hidden_dim)
        latent = noise.unsqueeze(2).expand(batch_size, num_candidates, seq_len, self.latent_dim)
        decoded = self.decoder(torch.cat([context, latent], dim=-1))
        return decoded
