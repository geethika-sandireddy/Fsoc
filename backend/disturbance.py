"""
Disturbance & Noise Engine — ISRO PS-26169 Backend.
Applies noise and atmospheric disturbances directly to the FPA pixel buffer.

PS-26169 Noise Specifications:
- Salt & Pepper:     ~10% pixel density
- Gaussian:          Standard deviation ≤ 20 px intensity
- Poisson:           Shot noise (photon-limited sensor model)
- Jitter:            ±20 px random spatial displacement (user-defined)
- Atmosphere:        Clear / Haze / Fog / Rain / Low Light
- Platform Motion:   ±20 px/frame (max.), Default/Mandatory: Linear, Optional: Circular, Random, Spiral, Figure of 8
- Control Interval:  ≥ 20 Hz (≤ 50 ms)
"""

from __future__ import annotations

import dataclasses
import enum
import math
from typing import Dict, Tuple, Optional
import numpy as np


class AtmosphereCondition(enum.Enum):
    CLEAR = "clear"
    HAZE = "haze"
    FOG = "fog"
    RAIN = "rain"
    LOW_LIGHT = "low_light"


class PlatformMotionTrajectory(enum.Enum):
    LINEAR = "linear"          # Mandatory default per PS-26169
    CIRCULAR = "circular"      # Optional per PS-26169
    RANDOM = "random"          # Optional per PS-26169
    SPIRAL = "spiral"          # Optional per PS-26169
    FIGURE_OF_8 = "figure_of_8"# Optional per PS-26169


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
    platform_motion_trajectory: PlatformMotionTrajectory = PlatformMotionTrajectory.LINEAR


def validate_control_interval(interval_sec: float) -> float:
    """
    Validates that the control/update interval satisfies PS-26169:
    Update Interval >= 20 Hz, which implies interval_sec <= 0.05 s (50 ms).
    Raises ValueError if interval exceeds 50 ms.
    """
    if interval_sec > 0.05001:
        raise ValueError(
            f"PS-26169 requires update interval >= 20 Hz (<= 50 ms). Configured: {interval_sec * 1000:.1f} ms"
        )
    return max(0.001, float(interval_sec))


class DisturbanceEngine:
    """
    Applies configurable noise and atmospheric disturbances to FPA frames.
    All disturbances modify the actual pixel buffer — no decorative labels.
    """

    def __init__(self, seed: int = 26169) -> None:
        self.rng = np.random.default_rng(seed)
        self.config = NoiseConfig()

        # Continuous platform motion tracking state for temporal coherence
        self.plat_x: float = 0.0
        self.plat_y: float = 0.0
        self.plat_vx: float = 2.5   # px/frame
        self.plat_vy: float = 1.8   # px/frame
        self.plat_time: float = 0.0
        self.plat_omega: float = 0.5 # rad/s

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
            elif key == "platform_motion_trajectory" and isinstance(value, str):
                value = PlatformMotionTrajectory(value)
            if hasattr(self.config, key):
                setattr(self.config, key, value)

    def get_config_dict(self) -> Dict:
        """Returns current config as a serializable dict."""
        d = dataclasses.asdict(self.config)
        d["atmosphere"] = self.config.atmosphere.value
        d["platform_motion_trajectory"] = self.config.platform_motion_trajectory.value
        return d

    def reset_platform_state(self) -> None:
        """Resets platform motion state."""
        self.plat_x = 0.0
        self.plat_y = 0.0
        self.plat_time = 0.0

    def compute_jitter_offset(self) -> Tuple[int, int]:
        """
        Returns a random (dx, dy) jitter displacement for the current frame.
        Applied BEFORE rendering to shift the apparent beacon position.
        PS-26169: Range: ±jitter_amplitude_px pixels (max ±20 px).
        """
        if not self.config.jitter_enabled:
            return (0, 0)
        amp = min(20.0, max(0.0, self.config.jitter_amplitude_px))
        dx = int(round(self.rng.uniform(-amp, amp)))
        dy = int(round(self.rng.uniform(-amp, amp)))
        return (dx, dy)

    def compute_platform_motion_offset(self, dt: float = 0.033) -> Tuple[int, int]:
        """
        Returns temporally coherent (dx, dy) platform motion displacement.
        PS-26169:
        - Max ±20 pixels/frame.
        - Mandatory/Default: Linear motion.
        - Optional: Circular, Random, Spiral, Figure of 8.
        """
        if not self.config.platform_motion_enabled:
            return (0, 0)

        amp = min(20.0, max(0.0, self.config.platform_motion_amplitude_px))
        traj = self.config.platform_motion_trajectory
        self.plat_time += dt

        if traj == PlatformMotionTrajectory.LINEAR:
            # Temporally coherent constant-velocity linear trajectory with smooth reflection
            self.plat_x += self.plat_vx
            self.plat_y += self.plat_vy

            if abs(self.plat_x) >= amp:
                self.plat_vx = -self.plat_vx
                self.plat_x = math.copysign(amp, self.plat_x)
            if abs(self.plat_y) >= amp:
                self.plat_vy = -self.plat_vy
                self.plat_y = math.copysign(amp, self.plat_y)

        elif traj == PlatformMotionTrajectory.CIRCULAR:
            theta = self.plat_omega * self.plat_time
            self.plat_x = amp * math.cos(theta)
            self.plat_y = amp * math.sin(theta)

        elif traj == PlatformMotionTrajectory.FIGURE_OF_8:
            theta = self.plat_omega * self.plat_time
            self.plat_x = amp * math.sin(theta)
            self.plat_y = amp * math.sin(2.0 * theta) * 0.5

        elif traj == PlatformMotionTrajectory.SPIRAL:
            theta = self.plat_omega * self.plat_time
            r = amp * (0.5 + 0.5 * math.sin(self.plat_omega * 0.25 * self.plat_time))
            self.plat_x = r * math.cos(theta)
            self.plat_y = r * math.sin(theta)

        elif traj == PlatformMotionTrajectory.RANDOM:
            # Smooth bounded acceleration random walk
            ax = float(self.rng.uniform(-2.0, 2.0))
            ay = float(self.rng.uniform(-2.0, 2.0))
            self.plat_vx = max(-3.0, min(3.0, self.plat_vx + ax * dt))
            self.plat_vy = max(-3.0, min(3.0, self.plat_vy + ay * dt))
            self.plat_x += self.plat_vx
            self.plat_y += self.plat_vy
            self.plat_x = max(-amp, min(amp, self.plat_x))
            self.plat_y = max(-amp, min(amp, self.plat_y))

        return (int(round(self.plat_x)), int(round(self.plat_y)))

    def apply_coordinate_disturbances(
        self, proj_u: float, proj_v: float, dt: float = 0.033
    ) -> Tuple[float, float]:
        """
        Incorporate camera jitter and platform motion into apparent target sensor coordinates
        PRIOR to rendering.
        """
        jit_x, jit_y = self.compute_jitter_offset()
        plat_x, plat_y = self.compute_platform_motion_offset(dt=dt)
        return float(proj_u + jit_x + plat_x), float(proj_v + jit_y + plat_y)

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
        lam = np.clip(lam, 0.0, 1e6)
        noisy = self.rng.poisson(lam).astype(np.float64) / scale
        return np.clip(noisy, 0.0, 255.0).astype(frame.dtype)

    def apply_atmospheric_effects(self, frame: np.ndarray) -> np.ndarray:
        """
        Applies atmospheric disturbance to the FPA buffer:
        - Transmittance: reduces signal contrast
        - Scatter: adds Gaussian blur effect via additive noise
        - Brightness offset: shifts ambient light level
        """
        profile = self._atmo_profiles[self.config.atmosphere]

        if self.config.atmosphere == AtmosphereCondition.CLEAR:
            return frame

        out = frame.astype(np.float32)

        # 1. Transmittance attenuation (signal contrast reduction)
        t = profile["transmittance"]
        out = out * t

        # 2. Scatter (haze/fog diffuse glow)
        scatter = profile["scatter_std"]
        if scatter > 0.0:
            scatter_noise = self.rng.normal(0.0, scatter, size=frame.shape)
            out = out + scatter_noise

        # 3. Ambient brightness offset
        offset = profile["brightness_offset"]
        out = out + offset

        return np.clip(out, 0.0, 255.0).astype(frame.dtype)

    def apply_platform_motion_shift(self, frame: np.ndarray) -> np.ndarray:
        """
        Applies platform motion as a global frame translation (roll).
        This simulates mechanical vibration of the mounting platform on the image plane.
        """
        if not self.config.platform_motion_enabled:
            return frame

        dx, dy = self.compute_platform_motion_offset()
        if dx == 0 and dy == 0:
            return frame

        out = np.full_like(frame, 10)  # Dark fill for shifted regions
        h, w = frame.shape[:2]

        src_y_start = max(0, -dy)
        src_y_end = min(h, h - dy)
        src_x_start = max(0, -dx)
        src_x_end = min(w, w - dx)

        dst_y_start = max(0, dy)
        dst_y_end = min(h, h + dy)
        dst_x_start = max(0, dx)
        dst_x_end = min(w, w + dx)

        copy_h = min(src_y_end - src_y_start, dst_y_end - dst_y_start)
        copy_w = min(src_x_end - src_x_start, dst_x_end - dst_x_start)

        if copy_h > 0 and copy_w > 0:
            out[dst_y_start:dst_y_start + copy_h, dst_x_start:dst_x_start + copy_w] = (
                frame[src_y_start:src_y_start + copy_h, src_x_start:src_x_start + copy_w]
            )

        return out

    def apply_all(self, frame: np.ndarray) -> np.ndarray:
        """
        Applies all enabled disturbances in physically realistic optical order:
        1. Atmospheric transmission attenuation (signal degradation through medium)
        2. Poisson photon shot noise (sensor quantum efficiency)
        3. Gaussian readout/thermal noise (FPA electronics)
        4. Salt & Pepper pixel defects (dead/hot pixels)
        """
        out = frame.copy()
        out = self.apply_atmospheric_effects(out)
        out = self.apply_poisson_noise(out)
        out = self.apply_gaussian_noise(out)
        out = self.apply_salt_and_pepper(out)
        return out
