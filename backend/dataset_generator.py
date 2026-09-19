"""
Synthetic AI Dataset Generator for Beacon Detection — ISRO PS-26169.
Generates labeled 32x32 pixel ROI patches:
- Label 1 (Positive): Optical beacon spots of size 5-20 px under various noise regimes
  (10% S&P, Gaussian SD <= 20, Poisson, atmospheric attenuation, sub-pixel offsets).
- Label 0 (Negative): False candidate artifacts (isolated salt spikes, noise speckle,
  star glints, background clutter, empty deep-space).
"""

from __future__ import annotations

import math
from typing import Tuple
import numpy as np


class SyntheticBeaconDatasetGenerator:
    """
    Generates balanced, labeled training and evaluation datasets of 32x32 candidate patches.
    """

    def __init__(self, patch_size: int = 32, seed: int = 26169) -> None:
        self.patch_size = patch_size
        self.rng = np.random.default_rng(seed)

    def _render_beacon_patch(
        self,
        size: int,
        shape: str,
        offset_u: float,
        offset_v: float,
        peak_intensity: float,
    ) -> np.ndarray:
        """Renders an ideal optical beacon spot with sub-pixel centering within a 32x32 patch."""
        half = self.patch_size // 2
        # Center coordinates with sub-pixel offset
        cu = half + offset_u
        cv = half + offset_v

        v_grid, u_grid = np.ogrid[0 : self.patch_size, 0 : self.patch_size]
        du = u_grid - cu
        dv = v_grid - cv

        sigma = max(1.2, size / 3.0)

        if shape == "square":
            d = np.maximum(np.abs(du), np.abs(dv))
            intensity = peak_intensity * np.exp(-0.5 * (d / sigma) ** 2)
            mask = d <= (size / 2.0)
            intensity[mask] = peak_intensity
        elif shape == "circle":
            r_sq = du * du + dv * dv
            intensity = peak_intensity * np.exp(-0.5 * (r_sq / (sigma * sigma)))
        else:  # rectangle
            d = np.maximum(np.abs(du) / 1.5, np.abs(dv))
            intensity = peak_intensity * np.exp(-0.5 * (d / sigma) ** 2)

        return np.clip(intensity, 0, 255).astype(np.float32)

    def _apply_noise_to_patch(
        self,
        patch: np.ndarray,
        enable_sp: bool = True,
        sp_density: float = 0.10,
        enable_gauss: bool = True,
        gauss_std: float = 15.0,
        enable_poisson: bool = True,
        transmittance: float = 1.0,
    ) -> np.ndarray:
        """Applies atmospheric and sensor noise to patch."""
        out = patch.copy()

        # 1. Atmospheric transmission attenuation
        out = out * transmittance

        # 2. Poisson photon noise
        if enable_poisson:
            lam = np.clip(out * 1.0, 0.0, 1e5)
            out = self.rng.poisson(lam).astype(np.float32)

        # 3. Gaussian thermal / readout noise
        if enable_gauss and gauss_std > 0:
            noise = self.rng.normal(0.0, gauss_std, size=patch.shape)
            out = out + noise

        # 4. Salt & Pepper pixel defects
        if enable_sp and sp_density > 0:
            total = out.size
            num_salt = int(total * sp_density / 2.0)
            num_pepper = int(total * sp_density / 2.0)

            sy = self.rng.integers(0, self.patch_size, size=num_salt)
            sx = self.rng.integers(0, self.patch_size, size=num_salt)
            out[sy, sx] = 255.0

            py = self.rng.integers(0, self.patch_size, size=num_pepper)
            px = self.rng.integers(0, self.patch_size, size=num_pepper)
            out[py, px] = 0.0

        return np.clip(out, 0.0, 255.0).astype(np.uint8)

    def generate_positive_patch(self) -> np.ndarray:
        """Generates a single Label 1 (Beacon Spot) patch under random realistic noise."""
        size = int(self.rng.integers(5, 21))
        shape = str(self.rng.choice(["square", "circle", "rectangle"]))
        offset_u = float(self.rng.uniform(-3.5, 3.5))
        offset_v = float(self.rng.uniform(-3.5, 3.5))
        peak_intensity = float(self.rng.uniform(180.0, 255.0))

        # Base clean beacon
        patch = self._render_beacon_patch(size, shape, offset_u, offset_v, peak_intensity)

        # Add celestial ambient baseline (10-25 intensity)
        baseline = float(self.rng.uniform(8.0, 24.0))
        patch = np.maximum(patch, baseline)

        # Random noise parameters
        sp_den = float(self.rng.uniform(0.02, 0.10))
        g_std = float(self.rng.uniform(2.0, 20.0))
        trans = float(self.rng.uniform(0.40, 1.0))

        noisy = self._apply_noise_to_patch(
            patch,
            enable_sp=True,
            sp_density=sp_den,
            enable_gauss=True,
            gauss_std=g_std,
            enable_poisson=True,
            transmittance=trans,
        )
        return noisy

    def generate_negative_patch(self) -> np.ndarray:
        """Generates a single Label 0 (False Artifact / Noise) patch."""
        neg_type = self.rng.integers(0, 4)

        if neg_type == 0:
            # Type 0: Pure sensor noise & empty deep space
            base = np.full((self.patch_size, self.patch_size), float(self.rng.uniform(8.0, 20.0)), dtype=np.float32)
            g_std = float(self.rng.uniform(8.0, 22.0))
            sp_den = float(self.rng.uniform(0.04, 0.12))
            return self._apply_noise_to_patch(base, enable_sp=True, sp_density=sp_den, gauss_std=g_std)

        elif neg_type == 1:
            # Type 1: Isolated hot/dead pixels (Salt & Pepper spikes without Gaussian envelope)
            base = np.full((self.patch_size, self.patch_size), 12.0, dtype=np.float32)
            sp_den = float(self.rng.uniform(0.08, 0.14))
            return self._apply_noise_to_patch(base, enable_sp=True, sp_density=sp_den, gauss_std=5.0)

        elif neg_type == 2:
            # Type 2: Star glint or streak (distant point source, < 2 pixels wide, off-center)
            base = np.full((self.patch_size, self.patch_size), 12.0, dtype=np.float32)
            sx = int(self.rng.integers(2, self.patch_size - 2))
            sy = int(self.rng.integers(2, self.patch_size - 2))
            base[sy, sx] = float(self.rng.uniform(120.0, 220.0))
            return self._apply_noise_to_patch(base, enable_sp=True, sp_density=0.04, gauss_std=8.0)

        else:
            # Type 3: Linear background gradient or illuminated haze patch
            y_grad = np.linspace(0, float(self.rng.uniform(20.0, 80.0)), self.patch_size)
            base = np.tile(y_grad[:, np.newaxis], (1, self.patch_size)).astype(np.float32)
            return self._apply_noise_to_patch(base, enable_sp=True, sp_density=0.05, gauss_std=12.0)

    def generate_dataset(
        self, num_samples: int = 2000, test_split: float = 0.2
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Generates balanced synthetic dataset:
        Returns:
            X_train: (N_train, 1, 32, 32) float32 in [0, 1]
            y_train: (N_train,) int64 {0, 1}
            X_test:  (N_test, 1, 32, 32) float32 in [0, 1]
            y_test:  (N_test,) int64 {0, 1}
        """
        half = num_samples // 2
        patches = []
        labels = []

        # Positive samples (Label 1)
        for _ in range(half):
            p = self.generate_positive_patch()
            patches.append(p)
            labels.append(1)

        # Negative samples (Label 0)
        for _ in range(half):
            p = self.generate_negative_patch()
            patches.append(p)
            labels.append(0)

        X = np.array(patches, dtype=np.float32)[:, np.newaxis, :, :] / 255.0
        y = np.array(labels, dtype=np.int64)

        # Shuffle
        indices = np.arange(len(y))
        self.rng.shuffle(indices)
        X = X[indices]
        y = y[indices]

        # Train/Test Split
        split_idx = int(len(y) * (1.0 - test_split))
        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]

        return X_train, y_train, X_test, y_test
