"""
Disturbance & Noise Engine — ISRO PS-26169 Backend.
Applies noise and atmospheric disturbances directly to the FPA pixel buffer.

PS-26169 Noise Specifications:
- Salt & Pepper:  ~10% pixel density
- Gaussian:       Standard deviation ≤ 20 px intensity
- Poisson:        Shot noise (photon-limited sensor model)
- Jitter:         ±20 px random spatial displacement
- Atmosphere:     Clear / Haze / Fog / Rain / Low Light
- Platform Motion: ±20 px random displacement per frame
"""

from __future__ import annotations

import dataclasses
import enum
from typing import Dict, Tuple
import numpy as np


class AtmosphereCondition(enum.Enum):
    CLEAR = "clear"
    HAZE = "haze"
    FOG = "fog"
    RAIN = "rain"
    LOW_LIGHT = "low_light"


@dataclasses.dataclass
class NoiseConfig:
    """Configuration for all noise sources. Each can be individually toggled."""
    salt_pepper_enabled: bool = False
    salt_pepper_density: float = 0.10      # ~10% as per PS

    gaussian_enabled: bool = False
    gaussian_std: float = 15.0             # SD ≤ 20 px intensity

    poisson_enabled: bool = False
    poisson_scale: float = 1.0             # Photon count multiplier

    jitter_enabled: bool = False
    jitter_amplitude_px: float = 10.0      # ±20 px max

    atmosphere: AtmosphereCondition = AtmosphereCondition.CLEAR

    platform_motion_enabled: bool = False
    platform_motion_amplitude_px: float = 10.0  # ±20 px max


class DisturbanceEngine:
    """
    Applies configurable noise and atmospheric disturbances to FPA frames.
    All disturbances modify the actual pixel buffer — no decorative labels.
    """

    def __init__(self, seed: int = 26169) -> None:
        self.rng = np.random.default_rng(seed)
        self.config = NoiseConfig()

        # Pre-computed atmospheric transmittance/scatter profiles
        self._atmo_profiles: Dict[AtmosphereCondition, Dict] = {
            AtmosphereCondition.CLEAR: {
                "transmittance": 1.0,
                "scatter_std": 0.0,
                "brightness_offset": 0,
            },
            AtmosphereCondition.HAZE: {
                "transmittance": 0.70,
                "scatter_std": 3.0,
                "brightness_offset": 15,
            },
            AtmosphereCondition.FOG: {
                "transmittance": 0.35,
                "scatter_std": 8.0,
                "brightness_offset": 40,
            },
            AtmosphereCondition.RAIN: {
                "transmittance": 0.55,
                "scatter_std": 5.0,
                "brightness_offset": 10,
            },
            AtmosphereCondition.LOW_LIGHT: {
                "transmittance": 0.85,
                "scatter_std": 1.5,
                "brightness_offset": -30,
            },
        }

    def configure(self, **kwargs) -> None:
        """Update noise configuration fields by keyword."""
        for key, value in kwargs.items():
            if key == "atmosphere" and isinstance(value, str):
                value = AtmosphereCondition(value)
            if hasattr(self.config, key):
                setattr(self.config, key, value)

    def get_config_dict(self) -> Dict:
        """Returns current config as a serializable dict."""
        d = dataclasses.asdict(self.config)
        d["atmosphere"] = self.config.atmosphere.value
        return d

    def compute_jitter_offset(self) -> Tuple[int, int]:
        """
        Returns a random (dx, dy) jitter displacement for the current frame.
        Applied BEFORE rendering to shift the apparent beacon position.
        Range: ±jitter_amplitude_px pixels.
        """
        if not self.config.jitter_enabled:
            return (0, 0)
        amp = self.config.jitter_amplitude_px
        dx = int(round(self.rng.uniform(-amp, amp)))
        dy = int(round(self.rng.uniform(-amp, amp)))
        return (dx, dy)

    def compute_platform_motion_offset(self) -> Tuple[int, int]:
        """
        Returns a random (dx, dy) platform motion displacement.
        Applied as a global frame shift simulating mechanical vibration.
        Range: ±platform_motion_amplitude_px pixels.
        """
        if not self.config.platform_motion_enabled:
            return (0, 0)
        amp = self.config.platform_motion_amplitude_px
        dx = int(round(self.rng.uniform(-amp, amp)))
        dy = int(round(self.rng.uniform(-amp, amp)))
        return (dx, dy)

    def apply_salt_and_pepper(self, frame: np.ndarray) -> np.ndarray:
        """
        Applies salt-and-pepper noise: randomly sets pixels to 0 (pepper) or 255 (salt).
        Density ~10% total (5% salt, 5% pepper) as per PS-26169.
        """
        if not self.config.salt_pepper_enabled:
            return frame

        out = frame.copy()
        h, w = out.shape[:2]
        total_pixels = h * w
        density = min(1.0, max(0.0, self.config.salt_pepper_density))

        num_salt = int(total_pixels * density / 2.0)
        num_pepper = int(total_pixels * density / 2.0)

        # Salt (white pixels)
        salt_y = self.rng.integers(0, h, size=num_salt)
        salt_x = self.rng.integers(0, w, size=num_salt)
        out[salt_y, salt_x] = 255

        # Pepper (black pixels)
        pepper_y = self.rng.integers(0, h, size=num_pepper)
        pepper_x = self.rng.integers(0, w, size=num_pepper)
        out[pepper_y, pepper_x] = 0

        return out

    def apply_gaussian_noise(self, frame: np.ndarray) -> np.ndarray:
        """
        Adds zero-mean Gaussian noise with configurable standard deviation.
        PS-26169: SD ≤ 20 px intensity levels.
        """
        if not self.config.gaussian_enabled:
            return frame

        std = min(20.0, max(0.0, self.config.gaussian_std))
        noise = self.rng.normal(0.0, std, size=frame.shape)
        out = frame.astype(np.float32) + noise
        return np.clip(out, 0.0, 255.0).astype(frame.dtype)

    def apply_poisson_noise(self, frame: np.ndarray) -> np.ndarray:
        """
        Applies Poisson (shot) noise modeling photon-limited sensor behaviour.
        The noisy pixel value is drawn from Poisson(λ = pixel_value * scale).
        """
        if not self.config.poisson_enabled:
            return frame

        scale = max(0.01, self.config.poisson_scale)
        lam = frame.astype(np.float64) * scale
        # Clamp lambda to avoid overflow (max Poisson lambda ~1e6)
        lam = np.clip(lam, 0.0, 1e6)
        noisy = self.rng.poisson(lam).astype(np.float64) / scale
        return np.clip(noisy, 0.0, 255.0).astype(frame.dtype)

    def apply_atmospheric_effects(self, frame: np.ndarray) -> np.ndarray:
        """
        Applies atmospheric disturbance to the FPA buffer:
        - Transmittance: reduces signal contrast
        - Scatter: adds Gaussian blur effect via additive noise
        - Brightness offset: shifts ambient light level

        These modify the actual pixel data, not just a UI label.
        """
        profile = self._atmo_profiles[self.config.atmosphere]

        if self.config.atmosphere == AtmosphereCondition.CLEAR:
            return frame  # No modification

        out = frame.astype(np.float32)

        # 1. Transmittance: multiply signal by transmittance factor
        transmittance = profile["transmittance"]
        out = out * transmittance

        # 2. Scatter: additive Gaussian noise simulating light scatter
        scatter_std = profile["scatter_std"]
        if scatter_std > 0.0:
            scatter = self.rng.normal(0.0, scatter_std, size=out.shape).astype(np.float32)
            out = out + scatter

        # 3. Brightness offset: ambient light change
        brightness = profile["brightness_offset"]
        out = out + brightness

        return np.clip(out, 0.0, 255.0).astype(frame.dtype)

    def apply_platform_motion_shift(self, frame: np.ndarray) -> np.ndarray:
        """
        Applies platform motion as a global frame translation (roll).
        This simulates mechanical vibration of the mounting platform.
        """
        if not self.config.platform_motion_enabled:
            return frame

        dx, dy = self.compute_platform_motion_offset()

        if dx == 0 and dy == 0:
            return frame

        out = np.full_like(frame, 10)  # Dark fill for shifted regions
        h, w = frame.shape[:2]

        # Source region in original frame
        src_y_start = max(0, -dy)
        src_y_end = min(h, h - dy)
        src_x_start = max(0, -dx)
        src_x_end = min(w, w - dx)

        # Destination region in output frame
        dst_y_start = max(0, dy)
        dst_y_end = min(h, h + dy)
        dst_x_start = max(0, dx)
        dst_x_end = min(w, w + dx)

        copy_h = min(src_y_end - src_y_start, dst_y_end - dst_y_start)
        copy_w = min(src_x_end - src_x_start, dst_x_end - dst_x_start)

        if copy_h > 0 and copy_w > 0:
            out[dst_y_start:dst_y_start + copy_h, dst_x_start:dst_x_start + copy_w] = \
                frame[src_y_start:src_y_start + copy_h, src_x_start:src_x_start + copy_w]

        return out

    def apply_all(self, frame: np.ndarray) -> np.ndarray:
        """
        Applies all enabled disturbances in the correct order:
        1. Atmospheric effects (changes signal level)
        2. Poisson noise (photon-level, applied to attenuated signal)
        3. Gaussian noise (sensor read noise)
        4. Salt & Pepper (hot/dead pixels)
        5. Platform motion shift (mechanical vibration)

        Jitter is NOT applied here — it is applied as a coordinate offset
        BEFORE frame rendering (modifies beacon position, not pixel data).
        """
        out = self.apply_atmospheric_effects(frame)
        out = self.apply_poisson_noise(out)
        out = self.apply_gaussian_noise(out)
        out = self.apply_salt_and_pepper(out)
        out = self.apply_platform_motion_shift(out)
        return out
